use sha2::{Digest, Sha256};

pub fn fingerprint_token(token: &str) -> String {
    let mut h = Sha256::new();
    h.update(token.as_bytes());
    hex::encode(h.finalize())
}
