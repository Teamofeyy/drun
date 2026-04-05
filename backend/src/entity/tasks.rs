use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "tasks")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false, column_type = "Uuid")]
    pub id: Uuid,
    #[sea_orm(column_type = "Uuid")]
    pub agent_id: Uuid,
    pub kind: String,
    #[sea_orm(column_type = "Json")]
    pub payload: Json,
    pub status: String,
    pub created_at: DateTimeUtc,
    pub started_at: Option<DateTimeUtc>,
    pub completed_at: Option<DateTimeUtc>,
    pub error_message: Option<String>,
    pub retries_used: i32,
    pub max_retries: i32,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(has_one = "super::task_results::Entity")]
    TaskResult,
}

impl Related<super::task_results::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::TaskResult.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
