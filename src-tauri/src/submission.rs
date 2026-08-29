use serde::{Deserialize, Serialize};
use time::{Date, OffsetDateTime, macros::format_description};

/// The 13 fields the patient fills in, in the design's JSON shape.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Submission {
    pub first_name: String,
    pub last_name: String,
    pub preferred_name: Option<String>,
    pub address: String,
    pub city: String,
    pub province: String,
    pub postal_code: String,
    pub phone: String,
    pub email: Option<String>,
    pub date_of_birth: String,
    pub health_insurance_number: String,
    pub health_insurance_version: Option<String>,
    pub hc_type: String,
}

/// OSCAR's province and HC-type boxes are dropdowns whose options read `ON`, not
/// "Ontario". Collecting the code is what makes the value staff copy out the one
/// the dropdown actually takes.
const PROVINCES: [&str; 13] = [
    "AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT",
];

/// Names the field that failed and why, so the tablet can point at it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ValidationError {
    pub field: &'static str,
    pub reason: String,
}

impl std::fmt::Display for ValidationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.field, self.reason)
    }
}

impl std::error::Error for ValidationError {}

impl Submission {
    pub fn validate(&self) -> Result<(), ValidationError> {
        self.validate_on(OffsetDateTime::now_utc().date())
    }

    /// `today` is a parameter so the date-of-birth rule is testable without
    /// waiting for the clock.
    fn validate_on(&self, today: Date) -> Result<(), ValidationError> {
        required("first_name", &self.first_name)?;
        required("last_name", &self.last_name)?;
        required(
            "preferred_name",
            self.preferred_name.as_deref().unwrap_or_default(),
        )?;
        required("address", &self.address)?;
        required("city", &self.city)?;

        let province = required("province", &self.province)?;
        if !PROVINCES.contains(&province) {
            return Err(err("province", "must be a Canadian province or territory"));
        }

        let hc_type = required("hc_type", &self.hc_type)?;
        if !PROVINCES.contains(&hc_type) {
            return Err(err("hc_type", "must be a Canadian province or territory"));
        }

        let postal_code = required("postal_code", &self.postal_code)?;
        if !is_postal_code(postal_code) {
            return Err(err("postal_code", "must look like A1A 1A1"));
        }

        let phone = required("phone", &self.phone)?;
        if digits(phone).len() != 10 {
            return Err(err("phone", "must have 10 digits"));
        }

        // Ten digits is Ontario's format. The other provinces each have their own,
        // and guessing at twelve of them would refuse cards that are perfectly good.
        let number = required("health_insurance_number", &self.health_insurance_number)?;
        if hc_type == "ON" && (number.len() != 10 || !number.bytes().all(|b| b.is_ascii_digit())) {
            return Err(err("health_insurance_number", "must be 10 digits"));
        }

        let date_of_birth = required("date_of_birth", &self.date_of_birth)?;
        let format = format_description!("[year]-[month]-[day]");
        let date_of_birth = Date::parse(date_of_birth, format)
            .map_err(|_| err("date_of_birth", "must be a real date as YYYY-MM-DD"))?;
        if date_of_birth > today {
            return Err(err("date_of_birth", "must not be in the future"));
        }

        let email = required("email", self.email.as_deref().unwrap_or_default())?;
        if !is_email(email) {
            return Err(err("email", "must look like name@example.com"));
        }

        let version = required(
            "health_insurance_version",
            self.health_insurance_version.as_deref().unwrap_or_default(),
        )?;
        if version.len() != 2 || !version.bytes().all(|b| b.is_ascii_alphabetic()) {
            return Err(err("health_insurance_version", "must be two letters"));
        }

        Ok(())
    }
}

fn err(field: &'static str, reason: &str) -> ValidationError {
    ValidationError {
        field,
        reason: reason.to_string(),
    }
}

fn required<'a>(field: &'static str, value: &'a str) -> Result<&'a str, ValidationError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(err(field, "is required"));
    }
    Ok(value)
}

fn digits(value: &str) -> String {
    value.chars().filter(char::is_ascii_digit).collect()
}

/// Letter-digit-letter, digit-letter-digit, with or without the middle space.
fn is_postal_code(value: &str) -> bool {
    let chars: Vec<char> = value.chars().filter(|c| !c.is_whitespace()).collect();
    chars.len() == 6
        && chars.iter().enumerate().all(|(i, c)| {
            if i % 2 == 0 {
                c.is_ascii_alphabetic()
            } else {
                c.is_ascii_digit()
            }
        })
}

/// Deliberately shallow: one `@`, something either side, and a dotted domain.
/// Anything stricter rejects addresses that work.
fn is_email(value: &str) -> bool {
    let Some((local, domain)) = value.split_once('@') else {
        return false;
    };
    !value.contains(char::is_whitespace)
        && !local.is_empty()
        && !domain.contains('@')
        && domain.split('.').count() > 1
        && domain.split('.').all(|label| !label.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    use time::macros::date;

    const TODAY: Date = date!(2026 - 08 - 20);

    fn valid() -> Submission {
        Submission {
            first_name: "Jane".to_string(),
            last_name: "Doe".to_string(),
            preferred_name: Some("Janie".to_string()),
            address: "12 King St W".to_string(),
            city: "Toronto".to_string(),
            province: "ON".to_string(),
            postal_code: "M5H 1A1".to_string(),
            phone: "4165551234".to_string(),
            email: Some("jane@example.com".to_string()),
            date_of_birth: "1985-04-17".to_string(),
            health_insurance_number: "1234567890".to_string(),
            health_insurance_version: Some("AB".to_string()),
            hc_type: "ON".to_string(),
        }
    }

    fn failing_field(submission: Submission) -> &'static str {
        submission.validate_on(TODAY).unwrap_err().field
    }

    #[test]
    fn the_designs_example_payload_is_valid() {
        assert!(valid().validate_on(TODAY).is_ok());
    }

    #[test]
    fn a_missing_field_is_refused() {
        type Blank = fn(&mut Submission);

        let blanks: [(&str, Blank); 3] = [
            ("preferred_name", |s| s.preferred_name = None),
            ("email", |s| s.email = None),
            ("health_insurance_version", |s| {
                s.health_insurance_version = None
            }),
        ];

        for (field, blank) in blanks {
            let mut submission = valid();
            blank(&mut submission);
            assert_eq!(failing_field(submission), field);
        }
    }

    #[test]
    fn a_blank_field_counts_as_missing() {
        let submission = Submission {
            email: Some("  ".to_string()),
            ..valid()
        };
        assert_eq!(failing_field(submission), "email");
    }

    #[test]
    fn every_required_field_is_required() {
        type Blank = fn(&mut Submission);

        let blanks: [(&str, Blank); 13] = [
            ("first_name", |s| s.first_name = String::new()),
            ("last_name", |s| s.last_name = String::new()),
            ("preferred_name", |s| s.preferred_name = Some(String::new())),
            ("email", |s| s.email = Some(" ".to_string())),
            ("health_insurance_version", |s| {
                s.health_insurance_version = Some(String::new())
            }),
            ("address", |s| s.address = String::new()),
            ("city", |s| s.city = " ".to_string()),
            ("province", |s| s.province = String::new()),
            ("hc_type", |s| s.hc_type = String::new()),
            ("postal_code", |s| s.postal_code = String::new()),
            ("phone", |s| s.phone = String::new()),
            ("date_of_birth", |s| s.date_of_birth = String::new()),
            ("health_insurance_number", |s| {
                s.health_insurance_number = String::new()
            }),
        ];

        for (field, blank) in blanks {
            let mut submission = valid();
            blank(&mut submission);
            assert_eq!(failing_field(submission), field);
        }
    }

    #[test]
    fn a_postal_code_may_omit_the_space() {
        let submission = Submission {
            postal_code: "M5H1A1".to_string(),
            ..valid()
        };
        assert!(submission.validate_on(TODAY).is_ok());
    }

    #[test]
    fn a_misshapen_postal_code_is_refused() {
        for bad in ["M5H 1A", "12345", "MMM 111", "M5H 1A11"] {
            let submission = Submission {
                postal_code: bad.to_string(),
                ..valid()
            };
            assert_eq!(failing_field(submission), "postal_code");
        }
    }

    #[test]
    fn a_phone_number_may_carry_separators() {
        let submission = Submission {
            phone: "(416) 555-1234".to_string(),
            ..valid()
        };
        assert!(submission.validate_on(TODAY).is_ok());
    }

    #[test]
    fn a_phone_number_without_ten_digits_is_refused() {
        for bad in ["416555123", "41655512345", "four one six"] {
            let submission = Submission {
                phone: bad.to_string(),
                ..valid()
            };
            assert_eq!(failing_field(submission), "phone");
        }
    }

    #[test]
    fn an_email_without_a_dotted_domain_is_refused() {
        for bad in [
            "jane",
            "jane@",
            "@example.com",
            "jane@example",
            "ja ne@example.com",
        ] {
            let submission = Submission {
                email: Some(bad.to_string()),
                ..valid()
            };
            assert_eq!(failing_field(submission), "email");
        }
    }

    #[test]
    fn a_date_of_birth_must_be_a_real_past_date() {
        for bad in ["17-04-1985", "1985-02-30", "1985-13-01", "2026-08-21"] {
            let submission = Submission {
                date_of_birth: bad.to_string(),
                ..valid()
            };
            assert_eq!(failing_field(submission), "date_of_birth");
        }
    }

    #[test]
    fn a_date_of_birth_of_today_is_accepted() {
        let submission = Submission {
            date_of_birth: "2026-08-20".to_string(),
            ..valid()
        };
        assert!(submission.validate_on(TODAY).is_ok());
    }

    #[test]
    fn a_province_that_is_not_a_known_code_is_refused() {
        for bad in ["Ontario", "on", "ZZ"] {
            let submission = Submission {
                province: bad.to_string(),
                ..valid()
            };
            let error = submission.validate_on(TODAY).unwrap_err();
            assert_eq!(error.field, "province");
            assert_eq!(error.reason, "must be a Canadian province or territory");

            let submission = Submission {
                hc_type: bad.to_string(),
                ..valid()
            };
            assert_eq!(failing_field(submission), "hc_type");
        }
    }

    #[test]
    fn every_province_the_dropdown_offers_is_accepted() {
        for province in PROVINCES {
            let submission = Submission {
                province: province.to_string(),
                ..valid()
            };
            assert!(submission.validate_on(TODAY).is_ok());
        }
    }

    #[test]
    fn an_ontario_health_card_number_that_is_not_ten_digits_is_refused() {
        for bad in ["123456789", "12345678901", "123456789X"] {
            let submission = Submission {
                health_insurance_number: bad.to_string(),
                ..valid()
            };
            assert_eq!(failing_field(submission), "health_insurance_number");
        }
    }

    #[test]
    fn another_province_is_taken_at_its_own_format() {
        let submission = Submission {
            hc_type: "QC".to_string(),
            health_insurance_number: "DOEJ 9001 0112".to_string(),
            ..valid()
        };
        assert!(submission.validate_on(TODAY).is_ok());
    }

    #[test]
    fn another_provinces_health_card_number_is_still_required() {
        let submission = Submission {
            hc_type: "QC".to_string(),
            health_insurance_number: "  ".to_string(),
            ..valid()
        };
        assert_eq!(failing_field(submission), "health_insurance_number");
    }

    #[test]
    fn a_version_code_that_is_not_two_letters_is_refused() {
        for bad in ["A", "ABC", "A1"] {
            let submission = Submission {
                health_insurance_version: Some(bad.to_string()),
                ..valid()
            };
            assert_eq!(failing_field(submission), "health_insurance_version");
        }
    }

    #[test]
    fn the_error_names_the_field_and_the_reason() {
        let submission = Submission {
            phone: String::new(),
            ..valid()
        };
        let error = submission.validate_on(TODAY).unwrap_err();
        assert_eq!(error.to_string(), "phone: is required");
    }
}
