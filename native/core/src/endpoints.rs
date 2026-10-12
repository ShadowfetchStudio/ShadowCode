//! The user's own OpenAI-compatible endpoints (Ollama, LM Studio, a llama.cpp
//! or vLLM server, OpenAI, xAI or any compatible API) as composer picker
//! rows. They are the registry models the user added in Settings › Accounts
//! (`POST /api/models/endpoints` marks them `added_in: "settings"`). Other
//! registry rows stay out: the `model:` fallback in config.yaml, which the
//! engine registers on its own, and models a detection probe merely found.
//! Tasks on these rows run ShadowCode's own agent loop through
//! `model_registry::resolve`, like any registered model.
use crate::{
    config::{runs_on_this_computer, ModelConfig},
    model_registry, models,
};
use serde_json::{json, Value};

/// Providers that are plain OpenAI-compatible servers (`models::preset`).
pub const PROVIDERS: &[&str] = &[
    "ollama",
    "local",
    "llamacpp",
    "vllm",
    "openai_compatible",
    "grok",
];

/// The `metadata.added_in` of models added in Settings.
pub const ADDED_IN: &str = "settings";

/// A registry row the user added for a compatible endpoint in Settings: a
/// known provider and an address (the managed local runtime has none).
pub fn is_endpoint_row(row: &Value) -> bool {
    PROVIDERS.contains(&row["provider"].as_str().unwrap_or(""))
        && !row["endpoint"].as_str().unwrap_or("").is_empty()
        && row.pointer("/metadata/added_in") == Some(&json!(ADDED_IN))
}

/// "127.0.0.1:11434", "api.openai.com": where the row sends its requests.
pub fn host(endpoint: &str) -> String {
    reqwest::Url::parse(endpoint)
        .ok()
        .and_then(|url| {
            let host = url.host_str()?.to_owned();
            Some(match url.port() {
                Some(port) => format!("{host}:{port}"),
                None => host,
            })
        })
        .unwrap_or_else(|| endpoint.to_owned())
}

/// The name a new endpoint's key is saved under. Two different services
/// must not overwrite each other's key, so a generic compatible API on a
/// named host gets a name of its own ("api.deepseek.com" → DEEPSEEK_API_KEY;
/// "api.openai.com" keeps the familiar OPENAI_API_KEY). Presets and
/// addresses without a domain name use the preset's name.
pub fn key_name(provider: &str, endpoint: &str) -> String {
    let preset = models::preset(provider)["api_key_env"]
        .as_str()
        .unwrap_or("OPENAI_API_KEY")
        .to_owned();
    if provider != "openai_compatible" {
        return preset;
    }
    let Some(host) = reqwest::Url::parse(endpoint)
        .ok()
        .and_then(|url| url.domain().map(str::to_owned))
    else {
        return preset;
    };
    let labels: Vec<&str> = host.split('.').filter(|l| !l.is_empty()).collect();
    if labels.len() < 2 {
        return preset;
    }
    // The label before the public suffix, also for "example.co.uk".
    let mut index = labels.len() - 2;
    if index > 0 && matches!(labels[index], "co" | "com" | "net" | "org" | "ac" | "gov") {
        index -= 1;
    }
    let name: String = labels[index]
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_uppercase()
            } else {
                '_'
            }
        })
        .collect();
    if name.is_empty() || !name.starts_with(|c: char| c.is_ascii_alphabetic()) {
        return preset;
    }
    format!("{name}_API_KEY")
}

/// Picker rows for the user's endpoints. Rows on this computer join the
/// local group; every other row is an API row, billed by its provider and
/// off in offline mode. `has_key` says whether a key name has a saved value.
pub fn picker_rows(
    registry: &[Value],
    default_id: &str,
    offline: bool,
    has_key: impl Fn(&str) -> bool,
) -> Vec<Value> {
    registry
        .iter()
        .filter(|row| is_endpoint_row(row))
        .filter_map(|row| Some((row, model_registry::from_row(row).ok()?)))
        .map(|(row, model)| picker_row(row, &model, default_id, offline, &has_key))
        .collect()
}

fn picker_row(
    row: &Value,
    model: &ModelConfig,
    default_id: &str,
    offline: bool,
    has_key: &impl Fn(&str) -> bool,
) -> Value {
    let local = runs_on_this_computer(model);
    let label = models::preset(&model.provider)["label"]
        .as_str()
        .unwrap_or("OpenAI-compatible")
        .to_owned();
    let host = host(&model.endpoint);
    let key_required = row.pointer("/metadata/key_required") == Some(&json!(true));
    let (availability, availability_label, reason) = if offline && !local {
        (
            "unavailable",
            "Unavailable",
            "Offline mode: only models on this computer run".to_owned(),
        )
    } else if key_required && !has_key(&model.api_key_env) {
        (
            "sign_in",
            "Add API key",
            format!("Add the API key for {host} in Settings › Accounts"),
        )
    } else {
        ("ready", "Ready", String::new())
    };
    let usage = if local {
        json!(crate::cli_agent::usage::UsageSnapshot::local())
    } else {
        json!({
            "state": "api_key",
            "label": "Your endpoint · billed by the provider",
            "detail": [
                format!("Tasks go to {host} with your key; the provider bills each request."),
                "ShadowCode shows a cost only when the server reports one.",
                format!("Context window: {} tokens", model.context_limit),
            ],
            "plan": null,
            "pool": null,
            "pool_shared": false,
            "windows": [],
            "remaining_percent": null,
            "credits": null,
            "limit_reached": false,
            "last_refresh": null,
            "provider_usage_url": null,
        })
    };
    let capabilities = &row["metadata"]["capabilities"];
    json!({
        "id": model.default,
        "provider": model.provider,
        "account": "",
        "model": model.name,
        "route": "native",
        "group": if local { crate::cli_agent::picker::GROUP_LOCAL } else { "api" },
        "name": if local { format!("{} · This computer", model.name) } else { model.name.clone() },
        "subtitle": format!("{label} · {host}"),
        "inference": if local { "local" } else { "cloud" },
        "availability": availability,
        "availability_label": availability_label,
        "reason": reason,
        "featured": false,
        "vision": capabilities["vision"] == true,
        "tools": capabilities["tools"] != false,
        "is_default": model.default == default_id,
        "usage": usage,
        "endpoint": model.endpoint,
        "custom": true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(provider: &str, endpoint: &str, metadata: Value) -> Value {
        let name = "qwen3-coder";
        json!({
            "id": model_registry::model_id(provider, endpoint, name),
            "name": name,
            "provider": provider,
            "endpoint": endpoint,
            "context_limit": 32768,
            "metadata": metadata,
        })
    }

    #[test]
    fn only_rows_the_user_added_are_endpoints() {
        let added = json!({"api_key_env": "OLLAMA_API_KEY", "added_in": "settings"});
        assert!(is_endpoint_row(&row(
            "ollama",
            "http://127.0.0.1:11434/v1",
            added.clone()
        )));
        // Found by detection only, or registered by the engine itself (the
        // config.yaml fallback): not the user's endpoint rows.
        assert!(!is_endpoint_row(&row(
            "ollama",
            "http://127.0.0.1:11434/v1",
            json!({"detected": true})
        )));
        assert!(!is_endpoint_row(&row(
            "local",
            "http://127.0.0.1:1234/v1",
            json!({"api_key_env": "OPENAI_API_KEY", "keep_alive": "30m"})
        )));
        // The managed runtime and other row kinds are listed elsewhere.
        assert!(!is_endpoint_row(&row("llamacpp", "", added.clone())));
        assert!(!is_endpoint_row(&row(
            "openrouter",
            "https://openrouter.ai/api/v1",
            added.clone()
        )));
        assert!(!is_endpoint_row(&row("mock", "", added)));
    }

    #[test]
    fn rows_on_this_computer_are_local_and_others_are_api_rows() {
        let rows = [
            row(
                "ollama",
                "http://127.0.0.1:11434/v1",
                json!({"api_key_env": "OLLAMA_API_KEY", "added_in": "settings"}),
            ),
            row(
                "openai_compatible",
                "https://api.deepseek.com/v1",
                json!({"api_key_env": "DEEPSEEK_API_KEY", "added_in": "settings", "key_required": true, "capabilities": {"vision": true}}),
            ),
        ];
        let picked = picker_rows(&rows, "", false, |_| true);
        assert_eq!(picked.len(), 2);
        assert_eq!(picked[0]["group"], "local");
        assert_eq!(picked[0]["inference"], "local");
        assert_eq!(picked[0]["name"], "qwen3-coder · This computer");
        assert_eq!(picked[0]["subtitle"], "Ollama · 127.0.0.1:11434");
        assert_eq!(picked[0]["usage"]["state"], "local");
        assert_eq!(picked[0]["availability"], "ready");
        assert_eq!(picked[1]["group"], "api");
        assert_eq!(picked[1]["inference"], "cloud");
        assert_eq!(
            picked[1]["subtitle"],
            "OpenAI-compatible · api.deepseek.com"
        );
        assert_eq!(picked[1]["usage"]["state"], "api_key");
        assert_eq!(picked[1]["vision"], true);
        assert_eq!(picked[1]["tools"], true);
        assert_eq!(picked[1]["custom"], true);
        // The row id is the registry id tasks resolve.
        assert_eq!(picked[1]["id"], rows[1]["id"]);
    }

    #[test]
    fn offline_and_missing_keys_block_only_what_they_must() {
        let rows = [
            row(
                "ollama",
                "http://127.0.0.1:11434/v1",
                json!({"api_key_env": "OLLAMA_API_KEY", "added_in": "settings"}),
            ),
            row(
                "grok",
                "https://api.x.ai/v1",
                json!({"api_key_env": "XAI_API_KEY", "added_in": "settings", "key_required": true}),
            ),
        ];
        let offline = picker_rows(&rows, "", true, |_| true);
        assert_eq!(offline[0]["availability"], "ready");
        assert_eq!(offline[1]["availability"], "unavailable");
        let no_key = picker_rows(&rows, "", false, |_| false);
        assert_eq!(no_key[0]["availability"], "ready");
        assert_eq!(no_key[1]["availability"], "sign_in");
        assert!(no_key[1]["reason"].as_str().unwrap().contains("api.x.ai"));
    }

    #[test]
    fn each_named_service_keeps_its_own_key() {
        assert_eq!(
            key_name("openai_compatible", "https://api.openai.com/v1"),
            "OPENAI_API_KEY"
        );
        assert_eq!(
            key_name("openai_compatible", "https://api.deepseek.com/v1"),
            "DEEPSEEK_API_KEY"
        );
        assert_eq!(
            key_name("openai_compatible", "https://api.groq.com/openai/v1"),
            "GROQ_API_KEY"
        );
        assert_eq!(
            key_name("openai_compatible", "https://llm.example.co.uk/v1"),
            "EXAMPLE_API_KEY"
        );
        assert_eq!(
            key_name("openai_compatible", "https://my-llm.dev/v1"),
            "MY_LLM_API_KEY"
        );
        // No domain name: the preset's name.
        assert_eq!(
            key_name("openai_compatible", "http://192.168.1.5:8000/v1"),
            "OPENAI_API_KEY"
        );
        assert_eq!(key_name("grok", "https://api.x.ai/v1"), "XAI_API_KEY");
        assert_eq!(
            key_name("ollama", "http://127.0.0.1:11434/v1"),
            "OLLAMA_API_KEY"
        );
        for name in [
            key_name("openai_compatible", "https://api.deepseek.com/v1"),
            key_name("openai_compatible", "https://my-llm.dev/v1"),
        ] {
            assert!(crate::config::valid_secret_name(&name), "{name}");
        }
    }

    #[test]
    fn hosts_name_the_server() {
        assert_eq!(host("http://127.0.0.1:11434/v1"), "127.0.0.1:11434");
        assert_eq!(host("https://api.openai.com/v1"), "api.openai.com");
    }
}
