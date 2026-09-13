pub fn resolve_release_version(
    injected: Option<&str>,
    package: &str,
) -> Result<String, &'static str> {
    let Some(version) = injected else {
        return Ok(package.to_owned());
    };
    let parts: Vec<_> = version.split('.').collect();
    if parts.len() != 3
        || parts.iter().any(|part| {
            part.is_empty()
                || !part.bytes().all(|byte| byte.is_ascii_digit())
                || (part.len() > 1 && part.starts_with('0'))
                || part.parse::<u64>().is_err()
        })
    {
        return Err("Release version must be a stable major.minor.patch version");
    }
    Ok(version.to_owned())
}

#[cfg(test)]
mod tests {
    use super::resolve_release_version;

    #[test]
    fn injected_release_is_used_without_changing_package_metadata() {
        assert_eq!(
            resolve_release_version(Some("1.4.6"), "1.4.5"),
            Ok("1.4.6".into())
        );
    }

    #[test]
    fn development_preserves_cargo_package_version() {
        for package in ["1.4.5", "1.4.6-dev"] {
            assert_eq!(resolve_release_version(None, package), Ok(package.into()));
        }
    }

    #[test]
    fn invalid_injection_cannot_fall_back_or_inject_build_output() {
        for value in [
            "",
            "v1.4.6",
            "1.4",
            "01.4.6",
            "1.4.6-rc1",
            "1.4.6\n",
            "1.4.6;echo bad",
        ] {
            assert!(resolve_release_version(Some(value), "1.4.5").is_err());
        }
    }

    #[test]
    fn embedded_version_matches_release_or_development_metadata() {
        assert_eq!(
            env!("PMTILES_VERSION"),
            option_env!("PMTILES_RELEASE_VERSION").unwrap_or(env!("CARGO_PKG_VERSION"))
        );
    }
}
