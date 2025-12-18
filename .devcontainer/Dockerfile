FROM mcr.microsoft.com/devcontainers/rust:1-bookworm

# Install Node.js 20.x
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs

# Install development tools
RUN apt-get update && apt-get install -y \
    build-essential \
    pkg-config \
    libssl-dev \
    git \
    redis-tools \
    && rm -rf /var/lib/apt/lists/*

# Install Rust development tools
RUN cargo install cargo-watch cargo-edit

# Set working directory
WORKDIR /workspaces

# Configure Git to trust the workspace directory
RUN git config --global --add safe.directory /workspaces/*
