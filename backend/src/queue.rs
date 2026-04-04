use redis::AsyncCommands;
use uuid::Uuid;

pub fn queue_key(agent_id: Uuid) -> String {
    format!("infrahub:q:{}", agent_id)
}

pub async fn enqueue(
    redis: &mut redis::aio::ConnectionManager,
    agent_id: Uuid,
    task_id: Uuid,
) -> Result<(), redis::RedisError> {
    let key = queue_key(agent_id);
    redis.lpush(key, task_id.to_string()).await
}

pub async fn dequeue(
    redis: &mut redis::aio::ConnectionManager,
    agent_id: Uuid,
) -> Result<Option<Uuid>, redis::RedisError> {
    let key = queue_key(agent_id);
    let v: Option<String> = redis::cmd("RPOP")
        .arg(&key)
        .query_async(&mut *redis)
        .await?;
    Ok(v.and_then(|s| Uuid::parse_str(&s).ok()))
}
