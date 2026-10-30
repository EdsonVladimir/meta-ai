//! Explicit domain identifiers.
//!
//! Each entity has its own type to avoid confusion. They arrive as
//! inputs and blanks are rejected; the domain generates no identifiers.

use std::fmt;

use crate::domain::CoreError;

macro_rules! id_type {
    ($name:ident, $entity:literal) => {
        #[derive(Debug, Clone, PartialEq, Eq, Hash)]
        pub struct $name(String);

        impl $name {
            pub fn new(id: impl Into<String>) -> Result<Self, CoreError> {
                let id = id.into();
                if id.trim().is_empty() {
                    return Err(CoreError::EmptyId { entity: $entity });
                }
                Ok(Self(id))
            }

            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str(&self.0)
            }
        }
    };
}

id_type!(ProjectId, "project");
id_type!(ModuleId, "module");
id_type!(ArtifactId, "artifact");
id_type!(VersionId, "version");
id_type!(BaselineId, "baseline");
id_type!(DeliveryId, "delivery");
id_type!(HumanId, "human");
id_type!(AgentId, "agent");

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_blank_ids() {
        assert!(matches!(
            ProjectId::new("  "),
            Err(CoreError::EmptyId { entity: "project" })
        ));
        assert!(matches!(
            VersionId::new(""),
            Err(CoreError::EmptyId { entity: "version" })
        ));
    }

    #[test]
    fn keeps_given_id() {
        let id = ArtifactId::new("req-1").expect("id");
        assert_eq!(id.as_str(), "req-1");
        assert_eq!(id.to_string(), "req-1");
    }
}
