package model

import (
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestNormalizeCodexInspectionConfigMigratesLegacyTargetType(t *testing.T) {
	input := ManagerCodexInspectionConfig{TargetType: " XAI "}

	got := NormalizeCodexInspectionConfig(input, DefaultCodexInspectionConfig())

	if !reflect.DeepEqual(got.TargetTypes, []string{CodexInspectionTargetXAI}) {
		t.Fatalf("TargetTypes = %#v, want xai", got.TargetTypes)
	}
	if got.TargetType != CodexInspectionTargetXAI {
		t.Fatalf("TargetType = %q, want xai", got.TargetType)
	}
}

func TestNormalizeCodexInspectionConfigSupportsMultipleTargets(t *testing.T) {
	input := ManagerCodexInspectionConfig{
		TargetTypes: []string{"xai", "codex", "xai"},
		TargetType:  "xai",
	}

	got := NormalizeCodexInspectionConfig(input, DefaultCodexInspectionConfig())

	if !reflect.DeepEqual(got.TargetTypes, []string{CodexInspectionTargetCodex, CodexInspectionTargetXAI}) {
		t.Fatalf("TargetTypes = %#v, want codex and xai", got.TargetTypes)
	}
	if got.TargetType != CodexInspectionTargetCodex {
		t.Fatalf("legacy TargetType = %q, want first normalized target", got.TargetType)
	}
}

func TestValidateCodexInspectionConfigRejectsInvalidTargetTypes(t *testing.T) {
	if err := ValidateCodexInspectionConfig(ManagerCodexInspectionConfig{TargetTypes: []string{}}); err == nil {
		t.Fatal("expected an explicitly empty targetTypes list to fail validation")
	}
	if err := ValidateCodexInspectionConfig(ManagerCodexInspectionConfig{TargetTypes: []string{"codex", "anthropic"}}); err == nil {
		t.Fatal("expected an unsupported target type to fail validation")
	}
}

func TestUnmarshalCodexInspectionSettingsMigratesLegacyTargetType(t *testing.T) {
	got := UnmarshalCodexInspectionSettings(`{"targetType":"xai"}`)

	if !reflect.DeepEqual(got.TargetTypes, []string{CodexInspectionTargetXAI}) || got.TargetType != CodexInspectionTargetXAI {
		t.Fatalf("legacy settings = %#v", got)
	}
}

func TestCodexInspectionSettingsRoundTripPreservesMultipleTargets(t *testing.T) {
	settings := NormalizeCodexInspectionConfig(ManagerCodexInspectionConfig{
		TargetTypes: []string{CodexInspectionTargetCodex, CodexInspectionTargetXAI},
	}, DefaultCodexInspectionConfig())

	got := UnmarshalCodexInspectionSettings(MarshalCodexInspectionSettings(settings))

	if !reflect.DeepEqual(got.TargetTypes, settings.TargetTypes) || got.TargetType != CodexInspectionTargetCodex {
		t.Fatalf("round-tripped settings = %#v", got)
	}
}

func TestNormalizeCodexInspectionTimeZone(t *testing.T) {
	cases := []struct {
		name     string
		value    string
		fallback string
		want     string
	}{
		{"empty falls back to default", "", "Asia/Shanghai", "Asia/Shanghai"},
		{"empty with empty fallback", "", "", ""},
		{"valid IANA wins", "Asia/Tokyo", "Asia/Shanghai", "Asia/Tokyo"},
		{"invalid falls back", "Mars/Olympus", "Asia/Shanghai", "Asia/Shanghai"},
		{"whitespace is trimmed", "  Europe/Berlin  ", "", "Europe/Berlin"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := NormalizeCodexInspectionTimeZone(c.value, c.fallback); got != c.want {
				t.Fatalf("got %q, want %q", got, c.want)
			}
		})
	}
}

func TestValidateCodexInspectionTimeZone(t *testing.T) {
	cases := []struct {
		name    string
		value   string
		wantErr bool
	}{
		{"empty uses server default", "", false},
		{"valid IANA", "Asia/Shanghai", false},
		{"whitespace is trimmed", "  Europe/Berlin  ", false},
		{"invalid is rejected", "Mars/Olympus", true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := ValidateCodexInspectionTimeZone(c.value)
			if c.wantErr && err == nil {
				t.Fatal("expected error")
			}
			if !c.wantErr && err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}

func TestResolveCodexInspectionLocation(t *testing.T) {
	if loc := ResolveCodexInspectionLocation(""); loc != time.Local {
		t.Fatalf("empty timezone should resolve to time.Local, got %v", loc)
	}
	if loc := ResolveCodexInspectionLocation("not-a-zone"); loc != time.Local {
		t.Fatalf("invalid timezone should resolve to time.Local, got %v", loc)
	}
	loc := ResolveCodexInspectionLocation("Asia/Shanghai")
	if loc == nil || !strings.Contains(loc.String(), "Asia/Shanghai") {
		t.Fatalf("expected Asia/Shanghai location, got %v", loc)
	}
}

func TestCodexInspectionScheduleDueWithTimeZone(t *testing.T) {
	enabled := true
	// 02:30 UTC == 10:30 Asia/Shanghai
	utcNow := time.Date(2026, 5, 22, 2, 30, 0, 0, time.UTC)

	cfg := DefaultCodexInspectionConfig()
	cfg.Enabled = &enabled
	cfg.Schedule.Mode = CodexInspectionScheduleModeTimePoints
	cfg.Schedule.TimePoints = []string{"10:30"}
	cfg.Schedule.TimeZone = "Asia/Shanghai"

	if !CodexInspectionScheduleDue(utcNow, time.Time{}, cfg) {
		t.Fatal("expected schedule to be due at 10:30 Asia/Shanghai")
	}

	// Same UTC moment is 22:30 in Pacific/Auckland; not due.
	cfg.Schedule.TimeZone = "Pacific/Auckland"
	cfg.Schedule.TimePoints = []string{"10:30"}
	if CodexInspectionScheduleDue(utcNow, time.Time{}, cfg) {
		t.Fatal("did not expect schedule to be due in Pacific/Auckland")
	}
}

func TestCodexInspectionTriggerKeyUsesTimeZone(t *testing.T) {
	utcNow := time.Date(2026, 5, 22, 2, 30, 0, 0, time.UTC)
	cfg := DefaultCodexInspectionConfig()
	cfg.Schedule.Mode = CodexInspectionScheduleModeTimePoints
	cfg.Schedule.TimePoints = []string{"10:30"}
	cfg.Schedule.TimeZone = "Asia/Shanghai"

	key := CodexInspectionTriggerKey(utcNow, cfg)
	if key != "2026-05-22 10:30" {
		t.Fatalf("trigger key in Asia/Shanghai = %q, want %q", key, "2026-05-22 10:30")
	}

	cfg.Schedule.TimeZone = "UTC"
	if got := CodexInspectionTriggerKey(utcNow, cfg); got != "2026-05-22 02:30" {
		t.Fatalf("trigger key in UTC = %q, want %q", got, "2026-05-22 02:30")
	}
}

func TestNormalizeCodexInspectionSchedulePreservesTimeZone(t *testing.T) {
	input := ManagerCodexInspectionScheduleConfig{
		Mode:       CodexInspectionScheduleModeTimePoints,
		TimePoints: []string{"09:00"},
		TimeZone:   "Asia/Shanghai",
	}
	out := NormalizeCodexInspectionSchedule(input, ManagerCodexInspectionScheduleConfig{})
	if out.TimeZone != "Asia/Shanghai" {
		t.Fatalf("TimeZone lost during normalize: %q", out.TimeZone)
	}

	bad := ManagerCodexInspectionScheduleConfig{
		Mode:       CodexInspectionScheduleModeTimePoints,
		TimePoints: []string{"09:00"},
		TimeZone:   "Mars/Olympus",
	}
	fallback := ManagerCodexInspectionScheduleConfig{TimeZone: "Europe/Berlin"}
	out = NormalizeCodexInspectionSchedule(bad, fallback)
	if out.TimeZone != "Europe/Berlin" {
		t.Fatalf("invalid TimeZone did not fall back, got %q", out.TimeZone)
	}
}
