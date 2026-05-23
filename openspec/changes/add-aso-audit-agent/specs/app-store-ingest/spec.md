## ADDED Requirements

### Requirement: Validate Apple App Store URLs before scraping

The system SHALL accept only valid Apple App Store URLs and reject everything else with a specific user-facing error before invoking any scraper.

A valid URL has hostname ending in `apps.apple.com` and a path matching `/<country>/app/<slug>/id<digits>` where `<country>` is a two-letter ISO country code, `<slug>` is one or more URL-safe segments, and `<digits>` is the numeric App Store app ID. The system SHALL extract `country` and `appId` from the URL for downstream use.

#### Scenario: Valid URL is accepted
- **WHEN** the user submits `https://apps.apple.com/us/app/spotify-music-and-podcasts/id324684580`
- **THEN** the system extracts `country = "us"` and `appId = "324684580"` and proceeds to scrape

#### Scenario: Non-Apple URL is rejected
- **WHEN** the user submits `https://play.google.com/store/apps/details?id=com.spotify.music`
- **THEN** the system replies with an error message explaining that only Apple App Store URLs are supported
- **AND** no scraper call is made

#### Scenario: Malformed Apple URL is rejected
- **WHEN** the user submits `https://apps.apple.com/` or any URL missing the `/app/<slug>/id<digits>` shape
- **THEN** the system replies with an error message describing the expected URL format
- **AND** no scraper call is made

### Requirement: Resolve an App Store URL to structured listing metadata

The system SHALL expose a Mastra tool that takes a validated App Store URL and returns a structured `AppListing` object containing the fields needed by the ASO audit.

The `AppListing` object MUST include: `appId`, `country`, `name`, `developer`, `category` (primary), `iconUrl`, `screenshotUrls` (ordered), `previewVideoUrl` (nullable), `description`, `subtitle` (nullable, if present on the listing), `currentVersion` (nullable), `whatsNew` (nullable), `averageRating` (nullable), `ratingCount` (nullable), `promotionalText` (nullable, when surfaced on the listing).

The tool MUST validate its input and output with Zod schemas. The tool SHALL use Firecrawl with a Zod-typed extraction schema rather than ad-hoc CSS selectors, so minor markup changes do not silently produce empty fields.

#### Scenario: Successful listing fetch returns full metadata
- **WHEN** the tool is invoked with a valid Apple App Store URL for a published app
- **THEN** the tool returns an `AppListing` with non-empty `name`, `developer`, `category`, `iconUrl`, and at least one `screenshotUrl`
- **AND** the returned object validates against the `AppListing` Zod schema

#### Scenario: Scraper failure surfaces as a typed error
- **WHEN** Firecrawl returns an error, times out, or returns content that cannot be parsed into `AppListing`
- **THEN** the tool returns a typed failure (does not throw silently, does not return empty fields as if they were data)
- **AND** the failure includes a human-readable message identifying which stage failed

#### Scenario: Optional fields tolerate absence
- **WHEN** the listing has no preview video, no subtitle, or no promotional text
- **THEN** those fields in `AppListing` are `null`
- **AND** the tool still returns a valid `AppListing` for the rest of the fields

### Requirement: Fetch top same-category competitors

The system SHALL expose a Mastra tool that, given a subject app's category, country, and `appId`, returns up to three `CompetitorSummary` objects representing competing apps in the same category, excluding the subject app itself.

`CompetitorSummary` is the subset of fields the audit needs for its comparison table: `appId`, `name`, `developer`, `title`, `subtitle`, `averageRating`, `ratingCount`, `screenshotCount`, `hasPreviewVideo`. The tool sources baseline fields from Apple's free iTunes Search API and enriches with Firecrawl only when necessary, to keep free-tier usage low.

If the competitor lookup fails entirely, the tool SHALL return an empty array with a typed warning. The audit pipeline SHALL continue rather than fail wholesale on competitor lookup failure.

#### Scenario: Top three competitors are returned
- **WHEN** the tool is invoked with `category = "Music"`, `country = "us"`, and the subject's `appId`
- **THEN** the tool returns an array of three `CompetitorSummary` objects from the Music category in the US store
- **AND** none of them have the subject's `appId`

#### Scenario: Competitor lookup failure does not crash the audit
- **WHEN** the competitor lookup returns an error or no results
- **THEN** the tool returns an empty array with a typed warning indicating competitor data was unavailable
- **AND** the warning is propagated so the audit can render a "Competitor data unavailable" section instead of failing

### Requirement: Scraper provider is abstracted behind a single module

The system SHALL isolate Firecrawl-specific code in a single scraper module so the scraping provider can be swapped without touching tools, agents, or workflows.

The scraper module SHALL accept its API key from environment configuration only, never from request input.

#### Scenario: Firecrawl is replaceable
- **WHEN** the scraper module is replaced with an alternative implementation that satisfies the same TypeScript interface
- **THEN** no tool, agent, or workflow file needs to change

#### Scenario: Missing API key fails fast at startup
- **WHEN** the Mastra service starts without `FIRECRAWL_API_KEY` set
- **THEN** the service fails fast with a clear error referencing the missing variable and `.env.example`
- **AND** no request is accepted that would have called Firecrawl
