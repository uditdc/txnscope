//! Latency benchmarks for the ingestor pipeline
//!
//! These benchmarks verify that the pipeline meets the <7ms latency budget:
//! - Decode & Filter: <5ms
//! - Redis Push: <2ms

use criterion::{black_box, criterion_group, criterion_main, Criterion};

/// Benchmark transaction decoding
fn bench_decode_transaction(c: &mut Criterion) {
    // TODO: Implement when decoder is complete
    c.bench_function("decode_transaction", |b| {
        b.iter(|| {
            // Placeholder - will benchmark actual decoding
            black_box(42)
        })
    });
}

/// Benchmark method ID filtering
fn bench_filter_method_id(c: &mut Criterion) {
    use txnscope_ingestor::filter::is_dex_method;

    let method_id: [u8; 4] = [0x38, 0xed, 0x17, 0x39];

    c.bench_function("filter_method_id", |b| {
        b.iter(|| {
            black_box(is_dex_method(black_box(&method_id)))
        })
    });
}

/// Benchmark JSON message formatting
fn bench_format_message(c: &mut Criterion) {
    use txnscope_ingestor::publisher::TransactionMessage;

    let message = TransactionMessage {
        hash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef".to_string(),
        from: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266".to_string(),
        to: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D".to_string(),
        method: "swapExactTokensForTokens".to_string(),
        method_id: "0x38ed1739".to_string(),
        value: "1000000000000000000".to_string(),
        gas_price: "20000000000".to_string(),
        timestamp: 1703000000000,
    };

    c.bench_function("format_message_json", |b| {
        b.iter(|| {
            black_box(message.to_json().unwrap())
        })
    });
}

criterion_group!(
    benches,
    bench_decode_transaction,
    bench_filter_method_id,
    bench_format_message
);

criterion_main!(benches);
