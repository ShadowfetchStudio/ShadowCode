//! `model_outcomes` (schema 28): see [`crate::outcomes`].
use super::*;
use crate::outcomes::Outcome;

/// Insert or replace one finished task's outcome (a re-finished task keeps
/// only its latest outcome).
pub(super) fn record_on(db: &Connection, o: &Outcome) -> Result<()> {
    db.execute(
        "INSERT OR REPLACE INTO model_outcomes(task_id,session_id,workspace,model_id,model_label,mode,status,success,started_at,finished_at,duration_seconds,total_tokens,tokens_estimated,cost_usd,passed,recorded_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        params![
            o.task_id,
            o.session_id,
            o.workspace,
            o.model_id,
            o.model_label,
            o.mode,
            o.status,
            o.success,
            o.started_at,
            o.finished_at,
            o.duration_seconds,
            i64::try_from(o.total_tokens).unwrap_or(i64::MAX),
            o.tokens_estimated,
            o.cost_usd,
            o.passed,
            o.recorded_at,
        ],
    )?;
    Ok(())
}

impl Store {
    pub fn record_outcome(&self, outcome: &Outcome) -> Result<()> {
        record_on(&*self.lock()?, outcome)
    }

    /// The newest outcomes recorded in this project.
    pub fn model_outcomes(&self, workspace: &Path) -> Result<Vec<Outcome>> {
        let db = self.lock()?;
        let mut query = db.prepare(
            "SELECT task_id,session_id,workspace,model_id,model_label,mode,status,success,started_at,finished_at,duration_seconds,total_tokens,tokens_estimated,cost_usd,passed,recorded_at FROM model_outcomes WHERE workspace=? ORDER BY finished_at DESC LIMIT ?",
        )?;
        let rows = query.query_map(
            params![
                workspace.to_string_lossy(),
                crate::outcomes::MAX_ROWS as i64
            ],
            |r| {
                Ok(Outcome {
                    task_id: r.get(0)?,
                    session_id: r.get(1)?,
                    workspace: r.get(2)?,
                    model_id: r.get(3)?,
                    model_label: r.get(4)?,
                    mode: r.get(5)?,
                    status: r.get(6)?,
                    success: r.get(7)?,
                    started_at: r.get(8)?,
                    finished_at: r.get(9)?,
                    duration_seconds: r.get(10)?,
                    total_tokens: r.get::<_, i64>(11)?.max(0) as u64,
                    tokens_estimated: r.get(12)?,
                    cost_usd: r.get(13)?,
                    passed: r.get(14)?,
                    recorded_at: r.get(15)?,
                })
            },
        )?;
        Ok(rows.collect::<rusqlite::Result<_>>()?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn records_and_reads_back_per_project() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("s.sqlite")).unwrap();
        let mut outcome = Outcome {
            task_id: "t1".into(),
            session_id: "s1".into(),
            workspace: "/a".into(),
            model_id: "cli:codex".into(),
            model_label: "Codex".into(),
            mode: "code".into(),
            status: "completed".into(),
            success: true,
            finished_at: 5.0,
            duration_seconds: 5.0,
            total_tokens: 42,
            cost_usd: None,
            passed: Some(true),
            ..Default::default()
        };
        store.record_outcome(&outcome).unwrap();
        outcome.task_id = "t2".into();
        outcome.workspace = "/b".into();
        outcome.cost_usd = Some(0.25);
        outcome.passed = None;
        store.record_outcome(&outcome).unwrap();
        let a = store.model_outcomes(Path::new("/a")).unwrap();
        assert_eq!(a.len(), 1);
        assert_eq!(a[0].cost_usd, None);
        assert_eq!(a[0].passed, Some(true));
        assert_eq!(a[0].total_tokens, 42);
        let b = store.model_outcomes(Path::new("/b")).unwrap();
        assert_eq!(b[0].cost_usd, Some(0.25));
        assert_eq!(b[0].passed, None);
    }

    #[test]
    fn migrates_a_schema_27_database() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("s.sqlite");
        drop(Store::open(&path).unwrap());
        {
            let db = Connection::open(&path).unwrap();
            db.execute_batch("DROP TABLE model_outcomes; PRAGMA user_version=27;")
                .unwrap();
        }
        let store = Store::open(&path).unwrap();
        assert!(store.model_outcomes(Path::new("/a")).unwrap().is_empty());
        let version: i64 = store
            .lock()
            .unwrap()
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);
    }
}
