//! Per-model, per-project outcome history ("how did this model do here?").
//!
//! Each finished top-level task records one row in `model_outcomes`
//! (schema 28): the exact picker id that ran it, the project, wall time,
//! tokens, the cost **only when the provider, the vendor CLI or this computer
//! reported it** (an estimate from a price list, or an unknown price, is
//! stored as `NULL` and shown as "unavailable"), and whether observed
//! verification passed.
//!
//! [`summarize`] turns rows into per-model statistics (medians, pass rate,
//! sample counts), and [`suggest`] picks the cheapest model that passed in
//! this project before. A suggestion is only ever *offered*; the picker
//! never switches models on its own. Candidates must be ready in the picker,
//! run on this computer when the app is offline, and stay within the
//! spending limits for paid API models.
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Rows read per project when summarizing (newest first).
pub const MAX_ROWS: usize = 2000;
/// Samples per model that count toward its statistics (newest first).
pub const MAX_SAMPLES_PER_MODEL: usize = 50;

/// One finished task, as stored.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Outcome {
    pub task_id: String,
    pub session_id: String,
    pub workspace: String,
    /// Exact picker id (`run.model_id`, else `routing.model_id`).
    pub model_id: String,
    /// What the job showed as its model ("Codex", "qwen3-coder" …).
    pub model_label: String,
    pub mode: String,
    /// `completed`, `failed` …
    pub status: String,
    pub success: bool,
    pub started_at: f64,
    pub finished_at: f64,
    pub duration_seconds: f64,
    pub total_tokens: u64,
    /// Some token counts were estimated by ShadowCode.
    pub tokens_estimated: bool,
    /// US dollars, only when reported (never an estimate).
    pub cost_usd: Option<f64>,
    /// `Some(true)` observed verification passed, `Some(false)` it failed or
    /// the task failed, `None` nothing was verified.
    pub passed: Option<bool>,
    pub recorded_at: f64,
}

/// The outcome of a finished job record (the desktop job JSON with its
/// `result`), or `None` when it should not count: cancelled, a plain
/// command, or no known model. Subagents are skipped by the caller.
pub fn from_job(job: &Value, session_id: &str) -> Option<Outcome> {
    let result = job.get("result")?;
    if result["cancelled"] == true || job["status"] == "cancelled" {
        return None;
    }
    let mode = job["mode"].as_str().unwrap_or("code");
    if mode == "command" {
        return None;
    }
    let model_id = job["run"]["model_id"]
        .as_str()
        .or_else(|| job["routing"]["model_id"].as_str())
        .filter(|id| !id.is_empty() && *id != "mock")?
        .to_owned();
    let started_at = job["started_at"].as_f64()?;
    let finished_at = job["finished_at"].as_f64()?;
    let success = result["success"] == true;
    let usage = crate::usage::parse(&job["usage"]);
    Some(Outcome {
        task_id: job["task_id"].as_str()?.to_owned(),
        session_id: session_id.to_owned(),
        workspace: job["workspace"].as_str()?.to_owned(),
        model_label: job["model"].as_str().unwrap_or(&model_id).to_owned(),
        model_id,
        mode: mode.to_owned(),
        status: job["status"].as_str().unwrap_or("").to_owned(),
        success,
        started_at,
        finished_at,
        duration_seconds: (finished_at - started_at).max(0.0),
        total_tokens: usage.total_tokens,
        tokens_estimated: usage.estimated || job["usage_is_estimated"] == true,
        cost_usd: reported_cost(&usage),
        passed: passed(success, &result["verification"]),
        recorded_at: crate::now(),
    })
}

/// The cost only when it was reported: not from a price list, not partly
/// unknown, and a real amount.
pub fn reported_cost(usage: &crate::models::Usage) -> Option<f64> {
    usage
        .cost_usd
        .filter(|cost| !usage.cost_estimated && cost.is_finite() && *cost >= 0.0)
}

/// Pass/fail from the task's verification summary. Only observed command
/// evidence counts; a model's claim alone is "not verified" (`None`).
pub fn passed(success: bool, verification: &Value) -> Option<bool> {
    let observed = verification["commands"]
        .as_array()
        .is_some_and(|commands| !commands.is_empty());
    if verification["verified"] == true && success {
        Some(true)
    } else if observed || (!success && verification["status"] == "failed") {
        Some(false)
    } else {
        None
    }
}

/// Statistics for one model in one project.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct ModelStats {
    pub model_id: String,
    pub model_label: String,
    /// Finished tasks counted.
    pub samples: usize,
    pub median_seconds: Option<f64>,
    pub median_tokens: Option<u64>,
    /// Median over tasks whose cost was reported; `None` = unavailable.
    pub median_cost_usd: Option<f64>,
    /// Tasks whose cost was reported.
    pub cost_samples: usize,
    /// Tasks with a pass/fail verification result.
    pub verified_samples: usize,
    pub passes: usize,
    /// `passes / verified_samples`; `None` when nothing was verified.
    pub pass_rate: Option<f64>,
    pub last_finished_at: f64,
}

fn median(mut values: Vec<f64>) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    values.sort_by(f64::total_cmp);
    let mid = values.len() / 2;
    Some(if values.len().is_multiple_of(2) {
        (values[mid - 1] + values[mid]) / 2.0
    } else {
        values[mid]
    })
}

/// Per-model statistics, most samples first. `rows` may be in any order;
/// the newest [`MAX_SAMPLES_PER_MODEL`] per model count.
pub fn summarize(rows: &[Outcome]) -> Vec<ModelStats> {
    let mut sorted: Vec<&Outcome> = rows.iter().collect();
    sorted.sort_by(|a, b| b.finished_at.total_cmp(&a.finished_at));
    let mut groups: Vec<(String, Vec<&Outcome>)> = Vec::new();
    for row in sorted {
        match groups.iter_mut().find(|(id, _)| *id == row.model_id) {
            Some((_, list)) if list.len() >= MAX_SAMPLES_PER_MODEL => {}
            Some((_, list)) => list.push(row),
            None => groups.push((row.model_id.clone(), vec![row])),
        }
    }
    let mut stats: Vec<ModelStats> = groups
        .into_iter()
        .map(|(model_id, list)| {
            let costs: Vec<f64> = list.iter().filter_map(|r| r.cost_usd).collect();
            let verified: Vec<bool> = list.iter().filter_map(|r| r.passed).collect();
            let passes = verified.iter().filter(|p| **p).count();
            ModelStats {
                model_label: list[0].model_label.clone(),
                samples: list.len(),
                median_seconds: median(list.iter().map(|r| r.duration_seconds).collect()),
                median_tokens: median(list.iter().map(|r| r.total_tokens as f64).collect())
                    .map(|v| v.round() as u64),
                cost_samples: costs.len(),
                median_cost_usd: median(costs),
                verified_samples: verified.len(),
                passes,
                pass_rate: (!verified.is_empty()).then(|| passes as f64 / verified.len() as f64),
                last_finished_at: list[0].finished_at,
                model_id,
            }
        })
        .collect();
    stats.sort_by(|a, b| {
        b.samples
            .cmp(&a.samples)
            .then(b.last_finished_at.total_cmp(&a.last_finished_at))
    });
    stats
}

/// What the suggestion may choose from: the picker rows and the limits in
/// force right now.
#[derive(Clone, Debug, Default)]
pub struct Constraints {
    /// The app is offline: only models on this computer.
    pub offline: bool,
    /// Today's spending limit for paid API models is reached.
    pub daily_limit_reached: bool,
    /// The per-task limit for paid API models, when set.
    pub task_limit_usd: Option<f64>,
    /// The model currently chosen in the picker (never suggested again).
    pub current: Option<String>,
}

/// A model the user may switch to. Never applied without the user's click.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Suggestion {
    pub model_id: String,
    pub name: String,
    pub median_cost_usd: f64,
    pub pass_rate: f64,
    pub passes: usize,
    pub samples: usize,
    pub reason: String,
}

/// A paid API model (billed per token, under the spending limits).
fn is_paid_row(row: &Value) -> bool {
    row["group"] == "api" || row["billing"] == "api_key"
}

/// The cheapest model, by median reported cost, that passed verification in
/// this project at least once and can run now. Models whose cost was never
/// reported are not ranked: an unknown price is not cheap.
pub fn suggest(
    stats: &[ModelStats],
    targets: &[Value],
    limits: &Constraints,
) -> Option<Suggestion> {
    let mut best: Option<(&ModelStats, &Value, f64)> = None;
    for stat in stats {
        if stat.passes == 0 {
            continue;
        }
        let Some(cost) = stat.median_cost_usd else {
            continue;
        };
        let Some(row) = targets.iter().find(|row| row["id"] == stat.model_id) else {
            continue;
        };
        if row["availability"] != "ready" {
            continue;
        }
        if limits.offline && row["inference"] != "local" {
            continue;
        }
        if is_paid_row(row) {
            if limits.daily_limit_reached {
                continue;
            }
            if limits.task_limit_usd.is_some_and(|limit| cost > limit) {
                continue;
            }
        }
        let rate = stat.pass_rate.unwrap_or(0.0);
        let better = match best {
            None => true,
            Some((current, _, best_cost)) => {
                cost < best_cost
                    || (cost == best_cost
                        && (rate > current.pass_rate.unwrap_or(0.0)
                            || (rate == current.pass_rate.unwrap_or(0.0)
                                && stat.samples > current.samples)))
            }
        };
        if better {
            best = Some((stat, row, cost));
        }
    }
    let (stat, row, cost) = best?;
    if limits.current.as_deref() == Some(stat.model_id.as_str()) {
        return None;
    }
    let name = row["name"]
        .as_str()
        .filter(|n| !n.is_empty())
        .unwrap_or(&stat.model_label)
        .to_owned();
    Some(Suggestion {
        reason: format!(
            "Cheapest model that passed verification in this project: {} of {} verified tasks passed, median reported cost {}.",
            stat.passes,
            stat.verified_samples,
            crate::spending::money(cost)
        ),
        model_id: stat.model_id.clone(),
        name,
        median_cost_usd: cost,
        pass_rate: stat.pass_rate.unwrap_or(0.0),
        passes: stat.passes,
        samples: stat.samples,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn row(
        model: &str,
        finished: f64,
        secs: f64,
        cost: Option<f64>,
        passed: Option<bool>,
    ) -> Outcome {
        Outcome {
            task_id: format!("{model}-{finished}"),
            workspace: "/p".into(),
            model_id: model.into(),
            model_label: model.into(),
            started_at: finished - secs,
            finished_at: finished,
            duration_seconds: secs,
            total_tokens: 1000,
            cost_usd: cost,
            passed,
            success: true,
            ..Default::default()
        }
    }

    fn job(cost: Value, estimated: bool, verification: Value) -> Value {
        json!({
            "task_id":"t1","workspace":"/p","mode":"code","status":"completed","model":"Qwen",
            "started_at":100.0,"finished_at":160.0,
            "usage":{"total_tokens":1234,"cost_usd":cost,"cost_estimated":estimated},
            "run":{"model_id":"api:openrouter:qwen"},
            "result":{"success":true,"cancelled":false,"verification":verification}
        })
    }

    #[test]
    fn records_only_reported_costs() {
        let verified = json!({"verified":true,"commands":[{"exit_code":0}]});
        let reported = from_job(&job(json!(0.12), false, verified.clone()), "s").unwrap();
        assert_eq!(reported.cost_usd, Some(0.12));
        assert_eq!(reported.duration_seconds, 60.0);
        assert_eq!(reported.total_tokens, 1234);
        assert_eq!(reported.passed, Some(true));
        assert_eq!(reported.model_id, "api:openrouter:qwen");
        let estimated = from_job(&job(json!(0.12), true, verified.clone()), "s").unwrap();
        assert_eq!(
            estimated.cost_usd, None,
            "price-list estimates are not reported costs"
        );
        let unknown = from_job(&job(Value::Null, false, verified), "s").unwrap();
        assert_eq!(unknown.cost_usd, None);
    }

    #[test]
    fn skips_cancelled_and_command_jobs() {
        let mut cancelled = job(json!(0.1), false, json!({}));
        cancelled["result"]["cancelled"] = json!(true);
        assert!(from_job(&cancelled, "s").is_none());
        let mut command = job(json!(0.1), false, json!({}));
        command["mode"] = json!("command");
        assert!(from_job(&command, "s").is_none());
    }

    #[test]
    fn pass_requires_observed_verification() {
        assert_eq!(passed(true, &json!({"verified":true})), Some(true));
        assert_eq!(
            passed(true, &json!({"claim":"model_claim","commands":[]})),
            None
        );
        assert_eq!(
            passed(true, &json!({"verified":false,"commands":[{}]})),
            Some(false)
        );
        assert_eq!(
            passed(false, &json!({"verified":true,"commands":[{}]})),
            Some(false)
        );
        assert_eq!(passed(false, &json!({"commands":[]})), None);
    }

    #[test]
    fn summarizes_medians_and_pass_rate() {
        let rows = vec![
            row("a", 10.0, 10.0, Some(0.10), Some(true)),
            row("a", 20.0, 30.0, None, Some(false)),
            row("a", 30.0, 20.0, Some(0.30), None),
            row("b", 40.0, 5.0, None, None),
        ];
        let stats = summarize(&rows);
        assert_eq!(stats[0].model_id, "a");
        assert_eq!(stats[0].samples, 3);
        assert_eq!(stats[0].median_seconds, Some(20.0));
        assert_eq!(stats[0].cost_samples, 2);
        assert!((stats[0].median_cost_usd.unwrap() - 0.20).abs() < 1e-9);
        assert_eq!(stats[0].verified_samples, 2);
        assert_eq!(stats[0].pass_rate, Some(0.5));
        assert_eq!(
            stats[1].median_cost_usd, None,
            "no reported cost stays unavailable"
        );
        assert_eq!(stats[1].pass_rate, None);
    }

    fn target(id: &str, group: &str, inference: &str) -> Value {
        json!({"id":id,"name":id.to_uppercase(),"group":group,"inference":inference,"availability":"ready"})
    }

    #[test]
    fn suggests_cheapest_passing_model_within_rules() {
        let rows = vec![
            row("api:cheap", 1.0, 10.0, Some(0.05), Some(true)),
            row("api:dear", 2.0, 10.0, Some(0.50), Some(true)),
            row("api:never-passed", 3.0, 10.0, Some(0.01), Some(false)),
            row("cli:codex", 4.0, 10.0, None, Some(true)),
            row("local:gguf:x", 5.0, 10.0, Some(0.0), Some(true)),
        ];
        let stats = summarize(&rows);
        let targets = vec![
            target("api:cheap", "api", "cloud"),
            target("api:dear", "api", "cloud"),
            target("api:never-passed", "api", "cloud"),
            target("cli:codex", "subscriptions", "cloud"),
        ];
        let pick = suggest(&stats, &targets, &Constraints::default()).unwrap();
        assert_eq!(pick.model_id, "api:cheap");
        assert!(pick.reason.contains("$0.05"), "{}", pick.reason);

        // Daily limit reached: paid models are out, unknown cost is not ranked.
        let limits = Constraints {
            daily_limit_reached: true,
            ..Default::default()
        };
        assert!(suggest(&stats, &targets, &limits).is_none());

        // Per-task limit below the median cost excludes that model.
        let limits = Constraints {
            task_limit_usd: Some(0.01),
            ..Default::default()
        };
        assert!(suggest(&stats, &targets, &limits).is_none());

        // Offline: only models on this computer.
        let mut with_local = targets.clone();
        with_local.push(target("local:gguf:x", "local", "local"));
        let limits = Constraints {
            offline: true,
            ..Default::default()
        };
        assert_eq!(
            suggest(&stats, &with_local, &limits).unwrap().model_id,
            "local:gguf:x"
        );

        // Already selected: nothing to suggest.
        let limits = Constraints {
            current: Some("api:cheap".into()),
            ..Default::default()
        };
        assert!(suggest(&stats, &targets, &limits).is_none());

        // Not ready in the picker: skipped.
        let mut not_ready = targets.clone();
        not_ready[0]["availability"] = json!("sign_in");
        assert_eq!(
            suggest(&stats, &not_ready, &Constraints::default())
                .unwrap()
                .model_id,
            "api:dear"
        );
    }
}
