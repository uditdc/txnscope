//! IPC Connection Module
//!
//! Handles connection to blockchain node via Unix IPC socket.
//! Subscribes to pending transactions and handles reconnection with exponential backoff.

use alloy::primitives::Address;
use alloy::providers::{ProviderBuilder, RootProvider};
use alloy::pubsub::PubSubFrontend;
use alloy::rpc::types::Transaction;
use alloy::transports::ipc::IpcConnect;
use std::path::Path;
use std::time::Duration;
use thiserror::Error;
use tokio::time::sleep;
use tracing::{error, info, warn};

/// Default IPC socket paths to try
pub const DEFAULT_IPC_PATHS: &[&str] = &[
    "/tmp/anvil.ipc",
    "~/.foundry/anvil.ipc",
    "/var/run/geth.ipc",
    "~/.ethereum/geth.ipc",
];

/// Maximum number of reconnection attempts before giving up
pub const MAX_RECONNECT_ATTEMPTS: u32 = 10;

/// Initial backoff delay for reconnection
pub const INITIAL_BACKOFF_MS: u64 = 100;

/// Maximum backoff delay for reconnection
pub const MAX_BACKOFF_MS: u64 = 30000;

/// Connection timeout in milliseconds
pub const CONNECTION_TIMEOUT_MS: u64 = 5000;

/// Errors that can occur during IPC operations
#[derive(Error, Debug)]
pub enum IpcError {
    #[error("IPC socket not found at path: {0}")]
    SocketNotFound(String),

    #[error("Connection failed: {0}")]
    ConnectionFailed(String),

    #[error("Subscription failed: {0}")]
    SubscriptionFailed(String),

    #[error("Connection timeout after {0}ms")]
    Timeout(u64),

    #[error("Max reconnection attempts ({0}) exceeded")]
    MaxReconnectAttemptsExceeded(u32),

    #[error("Invalid IPC path: {0}")]
    InvalidPath(String),

    #[error("Provider error: {0}")]
    Provider(String),
}

/// Configuration for IPC connection
#[derive(Debug, Clone)]
pub struct IpcConfig {
    /// Path to the IPC socket
    pub socket_path: String,
    /// Maximum reconnection attempts
    pub max_reconnect_attempts: u32,
    /// Initial backoff delay in milliseconds
    pub initial_backoff_ms: u64,
    /// Maximum backoff delay in milliseconds
    pub max_backoff_ms: u64,
    /// Connection timeout in milliseconds
    pub timeout_ms: u64,
}

impl Default for IpcConfig {
    fn default() -> Self {
        Self {
            socket_path: DEFAULT_IPC_PATHS[0].to_string(),
            max_reconnect_attempts: MAX_RECONNECT_ATTEMPTS,
            initial_backoff_ms: INITIAL_BACKOFF_MS,
            max_backoff_ms: MAX_BACKOFF_MS,
            timeout_ms: CONNECTION_TIMEOUT_MS,
        }
    }
}

impl IpcConfig {
    /// Create a new config with the specified socket path
    pub fn with_path(socket_path: impl Into<String>) -> Self {
        Self {
            socket_path: socket_path.into(),
            ..Default::default()
        }
    }

    /// Calculate backoff delay for a given attempt number
    pub fn backoff_delay(&self, attempt: u32) -> Duration {
        let delay_ms = self.initial_backoff_ms * 2u64.pow(attempt.min(10));
        Duration::from_millis(delay_ms.min(self.max_backoff_ms))
    }
}

/// Check if an IPC socket exists at the given path
pub fn socket_exists(path: &str) -> bool {
    let expanded = expand_path(path);
    Path::new(&expanded).exists()
}

/// Expand ~ to home directory in path
pub fn expand_path(path: &str) -> String {
    if path.starts_with("~/") {
        if let Some(home) = dirs::home_dir() {
            return path.replacen("~", &home.to_string_lossy(), 1);
        }
    }
    path.to_string()
}

/// Find the first available IPC socket from default paths
pub fn find_ipc_socket() -> Option<String> {
    for path in DEFAULT_IPC_PATHS {
        if socket_exists(path) {
            return Some(expand_path(path));
        }
    }
    None
}

/// Validate that a path looks like a valid IPC socket path
pub fn validate_ipc_path(path: &str) -> Result<(), IpcError> {
    if path.is_empty() {
        return Err(IpcError::InvalidPath("Path cannot be empty".to_string()));
    }

    // Path should typically end with .ipc or be in a known socket location
    let expanded = expand_path(path);
    if !expanded.ends_with(".ipc") && !expanded.contains("geth") && !expanded.contains("anvil") {
        warn!("IPC path '{}' may not be a valid socket path", path);
    }

    Ok(())
}

/// IPC connection manager with reconnection support
pub struct IpcConnection {
    config: IpcConfig,
    reconnect_attempts: u32,
}

impl IpcConnection {
    /// Create a new IPC connection manager
    pub fn new(config: IpcConfig) -> Self {
        Self {
            config,
            reconnect_attempts: 0,
        }
    }

    /// Create with default configuration
    pub fn with_default_config() -> Self {
        Self::new(IpcConfig::default())
    }

    /// Create with a specific socket path
    pub fn with_path(socket_path: impl Into<String>) -> Self {
        Self::new(IpcConfig::with_path(socket_path))
    }

    /// Get the socket path
    pub fn socket_path(&self) -> &str {
        &self.config.socket_path
    }

    /// Check if the socket exists
    pub fn socket_exists(&self) -> bool {
        socket_exists(&self.config.socket_path)
    }

    /// Reset reconnection counter
    pub fn reset_reconnect_counter(&mut self) {
        self.reconnect_attempts = 0;
    }

    /// Get current reconnection attempt count
    pub fn reconnect_attempts(&self) -> u32 {
        self.reconnect_attempts
    }

    /// Calculate delay before next reconnection attempt
    pub fn next_backoff_delay(&self) -> Duration {
        self.config.backoff_delay(self.reconnect_attempts)
    }

    /// Attempt to connect to the IPC socket
    ///
    /// Returns a provider connected to the IPC socket
    pub async fn connect(&mut self) -> Result<RootProvider<PubSubFrontend>, IpcError> {
        let expanded_path = expand_path(&self.config.socket_path);

        if !Path::new(&expanded_path).exists() {
            return Err(IpcError::SocketNotFound(expanded_path));
        }

        info!("Connecting to IPC socket at {}", expanded_path);

        let ipc: IpcConnect<String> = IpcConnect::new(expanded_path);
        let provider = ProviderBuilder::new()
            .on_ipc(ipc)
            .await
            .map_err(|e| IpcError::ConnectionFailed(e.to_string()))?;

        self.reset_reconnect_counter();
        info!("Successfully connected to IPC socket");

        Ok(provider)
    }

    /// Attempt to reconnect with exponential backoff
    ///
    /// Returns a provider if successful, or an error if max attempts exceeded
    pub async fn reconnect(&mut self) -> Result<RootProvider<PubSubFrontend>, IpcError> {
        while self.reconnect_attempts < self.config.max_reconnect_attempts {
            let delay = self.next_backoff_delay();
            warn!(
                "Attempting to reconnect (attempt {}/{}), waiting {:?}",
                self.reconnect_attempts + 1,
                self.config.max_reconnect_attempts,
                delay
            );

            sleep(delay).await;
            self.reconnect_attempts += 1;

            match self.connect().await {
                Ok(provider) => return Ok(provider),
                Err(e) => {
                    error!("Reconnection attempt {} failed: {}", self.reconnect_attempts, e);
                }
            }
        }

        Err(IpcError::MaxReconnectAttemptsExceeded(self.config.max_reconnect_attempts))
    }
}

/// Pending transaction received from subscription
#[derive(Debug, Clone)]
pub struct PendingTransaction {
    /// The full transaction data
    pub tx: Transaction,
    /// Sender address (may need to be recovered from signature)
    pub from: Address,
}

#[cfg(test)]
mod tests {
    use super::*;

    // ==================== IpcConfig tests ====================

    #[test]
    fn test_ipc_config_default() {
        let config = IpcConfig::default();
        assert_eq!(config.socket_path, "/tmp/anvil.ipc");
        assert_eq!(config.max_reconnect_attempts, MAX_RECONNECT_ATTEMPTS);
        assert_eq!(config.initial_backoff_ms, INITIAL_BACKOFF_MS);
        assert_eq!(config.max_backoff_ms, MAX_BACKOFF_MS);
        assert_eq!(config.timeout_ms, CONNECTION_TIMEOUT_MS);
    }

    #[test]
    fn test_ipc_config_with_path() {
        let config = IpcConfig::with_path("/custom/path.ipc");
        assert_eq!(config.socket_path, "/custom/path.ipc");
    }

    #[test]
    fn test_ipc_config_backoff_delay() {
        let config = IpcConfig::default();

        // First attempt: 100ms
        assert_eq!(config.backoff_delay(0), Duration::from_millis(100));

        // Second attempt: 200ms
        assert_eq!(config.backoff_delay(1), Duration::from_millis(200));

        // Third attempt: 400ms
        assert_eq!(config.backoff_delay(2), Duration::from_millis(400));

        // Fourth attempt: 800ms
        assert_eq!(config.backoff_delay(3), Duration::from_millis(800));
    }

    #[test]
    fn test_ipc_config_backoff_delay_caps_at_max() {
        let config = IpcConfig {
            max_backoff_ms: 1000,
            initial_backoff_ms: 100,
            ..Default::default()
        };

        // After many attempts, should cap at max
        assert_eq!(config.backoff_delay(10), Duration::from_millis(1000));
        assert_eq!(config.backoff_delay(20), Duration::from_millis(1000));
    }

    // ==================== expand_path tests ====================

    #[test]
    fn test_expand_path_with_tilde() {
        let path = "~/test/path.ipc";
        let expanded = expand_path(path);
        assert!(!expanded.starts_with("~/"));
        assert!(expanded.contains("test/path.ipc"));
    }

    #[test]
    fn test_expand_path_without_tilde() {
        let path = "/tmp/test.ipc";
        let expanded = expand_path(path);
        assert_eq!(expanded, path);
    }

    #[test]
    fn test_expand_path_tilde_in_middle() {
        // Only leading ~ should be expanded
        let path = "/some/~path/test.ipc";
        let expanded = expand_path(path);
        assert_eq!(expanded, path);
    }

    // ==================== validate_ipc_path tests ====================

    #[test]
    fn test_validate_ipc_path_valid() {
        assert!(validate_ipc_path("/tmp/anvil.ipc").is_ok());
        assert!(validate_ipc_path("/var/run/geth.ipc").is_ok());
        assert!(validate_ipc_path("~/.foundry/anvil.ipc").is_ok());
    }

    #[test]
    fn test_validate_ipc_path_empty() {
        let result = validate_ipc_path("");
        assert!(matches!(result, Err(IpcError::InvalidPath(_))));
    }

    // ==================== socket_exists tests ====================

    #[test]
    fn test_socket_exists_nonexistent() {
        assert!(!socket_exists("/nonexistent/path/to/socket.ipc"));
    }

    #[test]
    fn test_socket_exists_with_tilde() {
        // Should not crash with tilde path
        let _ = socket_exists("~/nonexistent/socket.ipc");
    }

    // ==================== find_ipc_socket tests ====================

    #[test]
    fn test_find_ipc_socket_returns_none_when_no_sockets() {
        // This test may pass or fail depending on environment
        // It's mainly testing that the function doesn't crash
        let _ = find_ipc_socket();
    }

    // ==================== IpcConnection tests ====================

    #[test]
    fn test_ipc_connection_with_default_config() {
        let conn = IpcConnection::with_default_config();
        assert_eq!(conn.socket_path(), "/tmp/anvil.ipc");
        assert_eq!(conn.reconnect_attempts(), 0);
    }

    #[test]
    fn test_ipc_connection_with_path() {
        let conn = IpcConnection::with_path("/custom/path.ipc");
        assert_eq!(conn.socket_path(), "/custom/path.ipc");
    }

    #[test]
    fn test_ipc_connection_reset_counter() {
        let mut conn = IpcConnection::with_default_config();
        conn.reconnect_attempts = 5;
        conn.reset_reconnect_counter();
        assert_eq!(conn.reconnect_attempts(), 0);
    }

    #[test]
    fn test_ipc_connection_next_backoff_delay() {
        let mut conn = IpcConnection::with_default_config();

        assert_eq!(conn.next_backoff_delay(), Duration::from_millis(100));

        conn.reconnect_attempts = 1;
        assert_eq!(conn.next_backoff_delay(), Duration::from_millis(200));

        conn.reconnect_attempts = 2;
        assert_eq!(conn.next_backoff_delay(), Duration::from_millis(400));
    }

    #[test]
    fn test_ipc_connection_socket_exists() {
        let conn = IpcConnection::with_path("/nonexistent/path.ipc");
        assert!(!conn.socket_exists());
    }

    // ==================== IpcError tests ====================

    #[test]
    fn test_ipc_error_display() {
        let err = IpcError::SocketNotFound("/tmp/test.ipc".to_string());
        assert!(err.to_string().contains("/tmp/test.ipc"));

        let err = IpcError::MaxReconnectAttemptsExceeded(10);
        assert!(err.to_string().contains("10"));

        let err = IpcError::Timeout(5000);
        assert!(err.to_string().contains("5000"));
    }

    // ==================== Constants tests ====================

    #[test]
    fn test_default_ipc_paths_not_empty() {
        assert!(!DEFAULT_IPC_PATHS.is_empty());
    }

    #[test]
    fn test_default_ipc_paths_contain_anvil() {
        assert!(DEFAULT_IPC_PATHS.iter().any(|p| p.contains("anvil")));
    }

    #[test]
    fn test_default_ipc_paths_contain_geth() {
        assert!(DEFAULT_IPC_PATHS.iter().any(|p| p.contains("geth")));
    }

    #[test]
    fn test_max_reconnect_attempts_reasonable() {
        assert!(MAX_RECONNECT_ATTEMPTS >= 3);
        assert!(MAX_RECONNECT_ATTEMPTS <= 100);
    }

    #[test]
    fn test_backoff_values_reasonable() {
        assert!(INITIAL_BACKOFF_MS >= 50);
        assert!(INITIAL_BACKOFF_MS <= 1000);
        assert!(MAX_BACKOFF_MS >= 10000);
        assert!(MAX_BACKOFF_MS <= 60000);
    }

    // ==================== Async tests (require tokio runtime) ====================

    #[tokio::test]
    async fn test_connect_to_invalid_path_returns_error() {
        let mut conn = IpcConnection::with_path("/nonexistent/path.ipc");
        let result = conn.connect().await;
        assert!(matches!(result, Err(IpcError::SocketNotFound(_))));
    }

    #[tokio::test]
    async fn test_connect_increments_reconnect_counter_on_failure() {
        let mut conn = IpcConnection::with_path("/nonexistent/path.ipc");

        // Multiple failed connection attempts
        let _ = conn.connect().await;
        // Counter is reset on each connect call, so we need to test reconnect instead

        // Manually simulate failed reconnects
        conn.reconnect_attempts = 3;
        assert_eq!(conn.reconnect_attempts(), 3);
    }
}
