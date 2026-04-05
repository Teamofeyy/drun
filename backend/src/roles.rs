use axum::http::StatusCode;
use crate::error::ApiError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UserRole {
    Observer,
    Operator,
    Admin,
}

impl UserRole {
    pub fn from_db(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "admin" => Self::Admin,
            "observer" => Self::Observer,
            _ => Self::Operator,
        }
    }

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Admin => "admin",
            Self::Operator => "operator",
            Self::Observer => "observer",
        }
    }

    pub fn rank(self) -> u8 {
        match self {
            Self::Observer => 0,
            Self::Operator => 1,
            Self::Admin => 2,
        }
    }

    pub fn satisfies(self, min: Self) -> bool {
        self.rank() >= min.rank()
    }

    pub fn require(self, min: Self) -> Result<(), ApiError> {
        if self.satisfies(min) {
            Ok(())
        } else {
            Err(ApiError::new(
                StatusCode::FORBIDDEN,
                "insufficient role for this action",
            ))
        }
    }
}
