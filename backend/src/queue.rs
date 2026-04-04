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

/// Удаляет все ключи очередей `infrahub:q:*` (после очистки истории задач в БД).
pub async fn clear_all_agent_queues(
    redis: &mut redis::aio::ConnectionManager,
) -> Result<u64, redis::RedisError> {
    use redis::AsyncCommands;
    let keys: Vec<String> = redis.keys("infrahub:q:*").await?;
    for k in &keys {
        let _: () = redis.del(k).await?;
    }
    Ok(keys.len() as u64)
}
