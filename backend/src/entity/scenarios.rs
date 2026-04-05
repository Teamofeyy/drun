use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "scenarios")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false, column_type = "Uuid")]
    pub id: Uuid,
    #[sea_orm(unique)]
    pub slug: String,
    pub name: String,
    pub description: String,
    #[sea_orm(column_type = "Json")]
    pub tags: Json,
    #[sea_orm(column_type = "Json")]
    pub definition: Json,
    #[sea_orm(column_type = "Json")]
    pub input_schema: Json,
    pub summary_template: Option<String>,
    pub status: String,
    pub version: i32,
    pub is_preset: bool,
    #[sea_orm(column_type = "Uuid", nullable)]
    pub created_by: Option<Uuid>,
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
