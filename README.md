# Muse

**Use celebrity styling to inspire your look.**

Muse is a personalized beauty-inspiration workspace built for the [YouCam API Skin AI & Apparel VTO Hackathon](https://youcam-api.devpost.com/). It turns one guided selfie into a structured facial profile, five relevant celebrity or creator muses, a visual inspiration board, virtual hair and makeup experiments, and a product plan for recreating the result.

[Open the live app](https://muse-black-phi.vercel.app) · [Explore User 1](https://muse-black-phi.vercel.app) · [Explore User 2](https://muse-black-phi.vercel.app)

> The two sample boards are public and read-only. Choose **Explore Sample Board: User 1** or **User 2** on the landing page. Creating an assessment, rendering a look, or changing a product catalog requires an account.

![Muse landing page](docs/screenshots/muse-landing.png)

## The problem

Beauty inspiration often starts with an image that is compelling but not personally useful. A hairstyle, makeup placement, or color story can behave very differently across face proportions, coloring, hair, and skin. Search feeds maximize aspiration; they do not explain which references transfer well to a particular person.

Muse applies a familiar piece of beauty advice at product scale: begin with people who share meaningful features, then borrow techniques—not identities. It is not a beauty score. It is a reference-finding and experimentation system designed to help users appreciate and style their own features.

## What Muse does

1. A member creates a username/password account and uploads or captures one clear, front-facing selfie with YouCam Camera Kit guidance.
2. Three YouCam detectors convert that selfie into skin tone, coloring, and detailed facial-structure data.
3. Muse's weighted matching model compares the profile with a curated catalog of 103 muses. Detailed facial proportions are primary; coloring, hair, and user-provided representation context prevent implausible drift.
4. The five closest matches become an interactive, Pinterest-style collage assembled from 1,856 unique reference images and 412 curated hair and makeup looks.
5. Any reference image resolves privately to the approved transfer template for its look. Users can apply hair, makeup, or both to their stored selfie without losing the original.
6. **Achieve this look** turns a generated result into saved skin guidance, visual technique steps, an essential-product checklist, live Shopify catalog recommendations, and a persistent owned-product catalog.

![Muse read-only sample board](docs/screenshots/muse-sample-board.png)

## YouCam implementation

Muse uses the Skin AI track as the core of the product rather than as an isolated demo.

| YouCam capability | How Muse uses it | Consumer value |
| --- | --- | --- |
| AI Fitzpatrick Skin Type Analysis | Classifies the original assessment selfie | Constrains skin-tone matching and supports sun/skin context |
| AI Facial Color Tones Analyzer | Reads skin, eye, lip, brow, and hair colors | Improves color-family and muse recommendations |
| AI Face Attributes & Ratio Analyzer | Requests 14 structural groups, including eye shape/size/angle/spacing, eyelids, brows, lips, nose, cheekbones, and face shape | Makes recommendations depend on detailed, explainable overlap instead of a generic face-shape label |
| AI Skin Analysis V2.1 | Runs seven concerns on a dedicated close crop of the untouched assessment selfie and caches the result against that calibration | Creates a persistent skin summary and routine entry point without analyzing a makeup-altered image |
| AI Hair Style Virtual Try-On V2.1 | Applies the approved hairstyle reference to a selected compatible selfie branch | Lets users test silhouette, texture, and styling direction |
| AI Makeup Transfer | Applies the selected look's approved makeup template | Lets users test placement and color on their own face |
| AI Image Generator V2.0 | Rebuilds a standardized transfer reference when a curated template is rejected, then caches it by look | Makes difficult references reusable for future users instead of repeatedly failing |
| YouCam Camera Kit | Provides face, position, angle, and lighting cues during browser capture | Reduces invalid inputs before paid analysis begins |

A successful core profile uses the same original selfie for Fitzpatrick, color tones, and facial attributes. At the published hackathon unit rates, that profile consumes approximately **60 units**: 10 + 20 + 30. Skin Analysis and try-ons are opt-in follow-up actions.

## Matching model

The matcher is deterministic and inspectable. It normalizes YouCam's categorical outputs and computes weighted similarity across:

- face shape, cheekbones, nose width/length, and lip shape;
- eye shape, size, angle, spacing, and eyelid type;
- eyebrow shape, thickness, spacing, and length;
- sampled skin, hair, and eye color distance;
- Fitzpatrick neighborhood constraints;
- hair profile where reliable curator data exists; and
- user-provided representation context as a meaningful guardrail, while facial structure remains the primary signal.

Matches and the facial-analysis panel are persisted. Reloading or signing in on another device restores the same profile until the member explicitly chooses **Recalibrate**.

## Product experience

- Single-screen responsive workspace with no desktop page scrolling
- Overlapping, pan-and-zoom inspiration collage rather than a card grid
- Five-muse filter dock with match percentages
- Makeup and hair boards that expose every reference image while hiding internal curator titles
- Persistent photo library with original and generated selfie branches
- Compatible-base selection for layering hair over makeup or makeup over hair
- Provenance for every result: source selfie, hair reference, and makeup reference
- Duplicate-template warnings without blocking intentional rerenders
- Read-only public sample boards backed by real demo accounts
- Saved YouCam skin profile tied to the current original assessment selfie
- Visual, reusable technique tutorials for skin, makeup, and hair
- Essential-product requirements, owned-product fit assessment, and four varied live recommendations
- Shopify Global Catalog search, merchant links, saved products, product ratings, and interaction history prepared for future personalization

## Architecture

```mermaid
flowchart LR
    A["Browser capture or upload"] --> B["Next.js API routes"]
    B --> C["YouCam analysis APIs"]
    C --> D["Normalized facial profile"]
    D --> E["Weighted muse matcher"]
    E --> F["Muse board and look library"]
    F --> G["Durable try-on workflow"]
    G --> H["YouCam makeup, hair, or image generation"]
    H --> I["Vercel Blob result library"]
    B <--> J["Neon Postgres"]
    F --> K["Achieve mode"]
    K <--> L["Shopify Global Catalog"]
```

The app uses Next.js 16, React 19, Better Auth, Neon Postgres, Vercel Blob, Vercel Workflow, Sharp, YouCam APIs, and Shopify's Global Catalog endpoint. Long-running try-ons are durable workflows with polling, retry classification, persistent output IDs, and cached generated templates.

## Local development

### Requirements

- Node.js 20+
- npm
- PostgreSQL (Neon is used in production)
- A YouCam API key with access to the listed endpoints
- A Vercel Blob store for persistent selfie and render storage

### Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

Configure these server-side variables:

```bash
YOUCAM_API_KEY=your_server_api_key
YOUCAM_API_BASE_URL=https://yce-api-01.makeupar.com
DATABASE_URL=postgresql://user:password@host/database?sslmode=require
BETTER_AUTH_SECRET=generate_a_long_random_secret
BETTER_AUTH_URL=http://localhost:3000
BLOB_READ_WRITE_TOKEN=provided_by_your_vercel_blob_store
```

The YouCam key never reaches the browser. When it is missing, profile analysis intentionally returns a documented demo response rather than exposing a client credential.

### Database migrations

Run the migrations against `DATABASE_URL` before creating accounts:

```bash
node scripts/migrate-muse-profile.mjs
node scripts/migrate-look-library.mjs
node scripts/migrate-achieve-shopping.mjs
node scripts/migrate-generated-look-templates.mjs
node scripts/migrate-product-catalog.mjs
```

### Catalog regeneration

The curator workbooks live in `data/source/` and are excluded from Vercel deployments. Rebuild the normalized catalog with:

```bash
npm run catalog
```

The standard-library Python importer preserves one asset per unique image URL, maintains the approved try-on template for every look, repairs known name inconsistencies, and verifies the feature/photo join.

## Verification

```bash
npx tsc --noEmit --incremental false
npm run lint
npm run build
```

The deployed experience was also verified in a real browser against the landing page and the live read-only User 1 sample board.

## Judging-criteria alignment

- **Technological implementation:** multiple YouCam Skin APIs power the initial profile; virtual try-on, cached reference rebuilding, persistent branching, and saved analyses form a non-trivial end-to-end system.
- **Design:** Muse is a complete account-based product with guided capture, explainable matching, an art-directed board, try-on, provenance, achieve tutorials, and a product catalog—not a collection of API buttons.
- **Potential impact:** Muse helps beauty consumers translate inspiration to their own features and gives retailers a path from personalized discovery to relevant, attributable products.
- **Quality of the idea:** it combines feature similarity, curated visual references, virtual experimentation, and product-fit memory into a workflow that treats celebrity imagery as a learning tool rather than a beauty standard.

## Privacy, safety, and limitations

- Selfies and analyses are private to the signed-in account; public demos are read-only copies of designated demo accounts.
- Recalibration replaces the active assessment set while preserving intentional generated looks in the member library.
- Fitzpatrick and Skin Analysis outputs are informational personalization signals, not medical diagnoses or treatment advice.
- Muse does not score attractiveness and should not be used for identity verification.
- YouCam outputs can be uncertain. The UI surfaces detector failures and allows recalibration rather than silently inventing measurements.
- Product links are live catalog results from independent Shopify merchants; availability, price, claims, and suitability remain the merchant's responsibility.

## Demo video

The Devpost video will be a 1–3 minute walkthrough following [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md). The production app and both read-only sample boards are available now.

## License and media rights

The original Muse source code is released under the [MIT License](LICENSE). Celebrity/creator reference images, Pinterest source links, workbook contents, YouCam services, Shopify product data, fonts, and other third-party materials are **not** relicensed by that MIT grant; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). A commercial release should replace or separately license every external reference asset.
