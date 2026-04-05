use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "agents")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false, column_type = "Uuid")]
    pub id: Uuid,
    pub name: String,
    #[sea_orm(unique)]
    pub token_fingerprint: String,
    pub token_hash: String,
    pub created_at: DateTimeUtc,
    pub last_seen_at: Option<DateTimeUtc>,
    pub status: String,
    pub site: String,
    pub segment: String,
    pub role_tag: String,
    pub cpu_arch: Option<String>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
