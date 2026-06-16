# [13.35.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v13.34.0...v13.35.0) (2026-06-16)


### Bug Fixes

* **visual-flows:** [#424](https://github.com/Jaal-Yantra-Textiles/v2/issues/424) — bind execute_code {{...}} tokens as raw values ([#425](https://github.com/Jaal-Yantra-Textiles/v2/issues/425)) ([88b3219](https://github.com/Jaal-Yantra-Textiles/v2/commit/88b3219c4c2448ed5cb01a97a2f002a6fb4b27b3))


### Features

* **orders:** [#403](https://github.com/Jaal-Yantra-Textiles/v2/issues/403) — kind-aware admin order detail (attach execution links + work-status) ([#422](https://github.com/Jaal-Yantra-Textiles/v2/issues/422)) ([bb339cd](https://github.com/Jaal-Yantra-Textiles/v2/commit/bb339cd1b6fa6e6ff4b05a73bf58e842122e8acb)), closes [#342](https://github.com/Jaal-Yantra-Textiles/v2/issues/342)
* **orders:** [#403](https://github.com/Jaal-Yantra-Textiles/v2/issues/403) — surface work-status on the admin order LIST ([#423](https://github.com/Jaal-Yantra-Textiles/v2/issues/423)) ([6c08026](https://github.com/Jaal-Yantra-Textiles/v2/commit/6c08026fc83fa6015ec54773c03b7700e8aa8247))

# [13.34.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v13.33.0...v13.34.0) (2026-06-15)


### Bug Fixes

* **socials:** [#32](https://github.com/Jaal-Yantra-Textiles/v2/issues/32)A — re-encrypt fresh token over stale ciphertext (vflow 401) ([1672320](https://github.com/Jaal-Yantra-Textiles/v2/commit/16723202e214e0c42376a24e27268e4323584943))
* **visual-flows:** [#32](https://github.com/Jaal-Yantra-Textiles/v2/issues/32)B — robust failure alerting (cancelled + engine + no-silent-bail) ([1ae30d3](https://github.com/Jaal-Yantra-Textiles/v2/commit/1ae30d363b9627a7888c1f8d875e12c7713f8f5b)), closes [#26](https://github.com/Jaal-Yantra-Textiles/v2/issues/26)
* **socials:** [#32](https://github.com/Jaal-Yantra-Textiles/v2/issues/32)C — remove backticks from comment inside template literal (build break) ([7fd9e6f](https://github.com/Jaal-Yantra-Textiles/v2/commit/7fd9e6f7c19cab78074c96b4948990340acb09ef)), closes [#408](https://github.com/Jaal-Yantra-Textiles/v2/issues/408)
* **email:** seed visual-flow templates with verified from (no-reply@jaalyantra.com) ([dad0984](https://github.com/Jaal-Yantra-Textiles/v2/commit/dad09840a455b6481dc3db553daaaa70426e4dff))


### Features

* **partner-ui:** "What's new" dashboard changelog carousel ([a553359](https://github.com/Jaal-Yantra-Textiles/v2/commit/a55335982cf2fe67d187f3d05e2d091178ec4f87)), closes [#342](https://github.com/Jaal-Yantra-Textiles/v2/issues/342)
* **shipping:** [#31](https://github.com/Jaal-Yantra-Textiles/v2/issues/31) — migrate partner fulfilment routes onto resolveShippingProvider ([deedaa2](https://github.com/Jaal-Yantra-Textiles/v2/commit/deedaa21dcbd5e41bf644cf6478fc17e0954cd75))
* **shipping:** [#31](https://github.com/Jaal-Yantra-Textiles/v2/issues/31) — pluggable shipping-provider interface + Shiprocket (spike) ([1eaa1f3](https://github.com/Jaal-Yantra-Textiles/v2/commit/1eaa1f38792f4c224932700681d544b4b76f8b78))
* **shipping:** [#31](https://github.com/Jaal-Yantra-Textiles/v2/issues/31) — register Shiprocket fulfillment provider + auto-register pickup on store create ([001872a](https://github.com/Jaal-Yantra-Textiles/v2/commit/001872aae207ede77ea21693b57a13ad8f002547)), closes [#416](https://github.com/Jaal-Yantra-Textiles/v2/issues/416)
* **admin:** [#31](https://github.com/Jaal-Yantra-Textiles/v2/issues/31) — Shiprocket pickup opt-in widget on stock-location detail ([9ba8fa3](https://github.com/Jaal-Yantra-Textiles/v2/commit/9ba8fa319cfe98f4b43946771130e6edab5e007c))
* **shipping:** [#31](https://github.com/Jaal-Yantra-Textiles/v2/issues/31) — Shiprocket pickup-location registration + backfill ([6bff743](https://github.com/Jaal-Yantra-Textiles/v2/commit/6bff743abf613c25fd92b8a00e5e7a02436d95cb))
* **socials:** [#32](https://github.com/Jaal-Yantra-Textiles/v2/issues/32)A — redact secrets from social-platforms API, MFA-gated reveal ([d0f89f6](https://github.com/Jaal-Yantra-Textiles/v2/commit/d0f89f60878ef59d62681bf93279104b5328ed48))
* **visual-flows:** [#418](https://github.com/Jaal-Yantra-Textiles/v2/issues/418) — gate flow-start email behind per-flow toggle ([#419](https://github.com/Jaal-Yantra-Textiles/v2/issues/419)) ([ebb9e4b](https://github.com/Jaal-Yantra-Textiles/v2/commit/ebb9e4bf5c25d2fddf20c4a8b2de6a6198d30a1c))
* **partner-ui:** record real action GIFs for the What's-new carousel ([8599fad](https://github.com/Jaal-Yantra-Textiles/v2/commit/8599fad168a6e0a8f7304ffad6fbce8b7e4f73c1))

# [13.33.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v13.32.0...v13.33.0) (2026-06-15)


### Bug Fixes

* **admin:** design detail 500 — customer.* → customers.* in DESIGN_DETAIL_FIELDS ([#397](https://github.com/Jaal-Yantra-Textiles/v2/issues/397)) ([5bdeb37](https://github.com/Jaal-Yantra-Textiles/v2/commit/5bdeb372adc9e1693e20e1d3e443abb16c1e9773))
* **admin:** design detail returns only id + relations — refetchDesign drops base columns ([#399](https://github.com/Jaal-Yantra-Textiles/v2/issues/399)) ([754a43f](https://github.com/Jaal-Yantra-Textiles/v2/commit/754a43f46dec5e845d7188602f103013d1a8c706)), closes [#397](https://github.com/Jaal-Yantra-Textiles/v2/issues/397)


### Features

* **orders:** [#342](https://github.com/Jaal-Yantra-Textiles/v2/issues/342) PR-D — concurrency hardening (locking + Redis provider) ([#395](https://github.com/Jaal-Yantra-Textiles/v2/issues/395)) ([1ef9543](https://github.com/Jaal-Yantra-Textiles/v2/commit/1ef954378e2682aad12baea015c752c388a61bb1))
* **orders:** [#342](https://github.com/Jaal-Yantra-Textiles/v2/issues/342) PR-E Chunk 9 — backfill order↔execution links (script) ([#396](https://github.com/Jaal-Yantra-Textiles/v2/issues/396)) ([e9c5be0](https://github.com/Jaal-Yantra-Textiles/v2/commit/e9c5be099167344b9e4583ac3c13fa3635942ff7))
* **orders:** [#342](https://github.com/Jaal-Yantra-Textiles/v2/issues/342) PR-F Chunk 9b-expand — unified_order_status sidecar column ([#398](https://github.com/Jaal-Yantra-Textiles/v2/issues/398)) ([9561a11](https://github.com/Jaal-Yantra-Textiles/v2/commit/9561a1104f4183f11d2a07544d26b276f99c4e7d))

# [13.32.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v13.31.0...v13.32.0) (2026-06-13)


### Features

* **orders:** [#342](https://github.com/Jaal-Yantra-Textiles/v2/issues/342) PR-C Chunk 6 — retire metadata.kind + unified_order_id (links authoritative) ([#394](https://github.com/Jaal-Yantra-Textiles/v2/issues/394)) ([1516f29](https://github.com/Jaal-Yantra-Textiles/v2/commit/1516f29142be82a5d5e91d1d9361427d7ca353c7))

# [13.31.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v13.30.0...v13.31.0) (2026-06-13)


### Features

* **orders:** [#342](https://github.com/Jaal-Yantra-Textiles/v2/issues/342) PR-B — unified surfacing (admin retail filter + partner panels) ([#393](https://github.com/Jaal-Yantra-Textiles/v2/issues/393)) ([c040598](https://github.com/Jaal-Yantra-Textiles/v2/commit/c04059815a15b029cfe823039703f89d05c58cf9))

# [13.30.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v13.29.0...v13.30.0) (2026-06-13)


### Features

* **orders:** [#342](https://github.com/Jaal-Yantra-Textiles/v2/issues/342) PR-A — D5 link adoption (define → write → read) ([#392](https://github.com/Jaal-Yantra-Textiles/v2/issues/392)) ([c4d0346](https://github.com/Jaal-Yantra-Textiles/v2/commit/c4d03469a26f7cbacebf3ed911df374ebaa0884b))
* **orders:** [#342](https://github.com/Jaal-Yantra-Textiles/v2/issues/342) T3.2 — dual-write unified core order for production runs ([#391](https://github.com/Jaal-Yantra-Textiles/v2/issues/391)) ([79fa85c](https://github.com/Jaal-Yantra-Textiles/v2/commit/79fa85c1eaea823ea44c1084c1072583a8df1790))

# [13.29.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v13.28.0...v13.29.0) (2026-06-12)


### Bug Fixes

* **342:** rescue post-merge commits — "partial" vocabulary + quantity_delta decimal fix ([#390](https://github.com/Jaal-Yantra-Textiles/v2/issues/390)) ([22ba25f](https://github.com/Jaal-Yantra-Textiles/v2/commit/22ba25ffc408283034c37520f44d0deed47cbac5)), closes [#342](https://github.com/Jaal-Yantra-Textiles/v2/issues/342)


### Features

* **orders:** [#342](https://github.com/Jaal-Yantra-Textiles/v2/issues/342) T3.1 — mirror legacy status onto unified order ([#389](https://github.com/Jaal-Yantra-Textiles/v2/issues/389)) ([285003a](https://github.com/Jaal-Yantra-Textiles/v2/commit/285003a5978b0acb15b0f81e2e52a14e49752eff))

# [13.28.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v13.27.0...v13.28.0) (2026-06-12)


### Bug Fixes

* **storefront:** derive base URL from Vercel env instead of localhost ([b99cc90](https://github.com/Jaal-Yantra-Textiles/v2/commit/b99cc9003b8626ad8826de974199fe330e6c9e20))
* **designs:** link designs to orders on purchase (roadmap [#29](https://github.com/Jaal-Yantra-Textiles/v2/issues/29)) ([5026753](https://github.com/Jaal-Yantra-Textiles/v2/commit/5026753f932e715cb018c8d5cdfba73583c47dc4)), closes [#381](https://github.com/Jaal-Yantra-Textiles/v2/issues/381)
* **storefront:** render gallery images in a client component ([3a02358](https://github.com/Jaal-Yantra-Textiles/v2/commit/3a0235802572427d664f7ce82b6d7b667122739d))
* **designs:** repair the 6 long-failing designs-api tests ([874f302](https://github.com/Jaal-Yantra-Textiles/v2/commit/874f302be622d8ed97e56ecebc42be5a7e4fbf1a))
* **web-media:** resolve album_id as a public folder when no album matches ([0ba935a](https://github.com/Jaal-Yantra-Textiles/v2/commit/0ba935a3fa48c2d5f4d1e11cf912eb9087bdfe50)), closes [#22](https://github.com/Jaal-Yantra-Textiles/v2/issues/22) [#334](https://github.com/Jaal-Yantra-Textiles/v2/issues/334)
* **api:** stop narrowing admin auth — restore API-key access on 11 routes ([892baba](https://github.com/Jaal-Yantra-Textiles/v2/commit/892baba4e1132c4d0cf1ba4061543b8a5ccc52ab))


### Features

* **orders:** [#342](https://github.com/Jaal-Yantra-Textiles/v2/issues/342) T2 — dual-write unified core order for inventory orders ([#387](https://github.com/Jaal-Yantra-Textiles/v2/issues/387)) ([9ac7810](https://github.com/Jaal-Yantra-Textiles/v2/commit/9ac7810f10e8da2da22fd65bd166f264666fff42))
* **storefront:** /gallery page rendering the open-archive paintings ([6c24d46](https://github.com/Jaal-Yantra-Textiles/v2/commit/6c24d4645454c9a5c83ac72e6b29b744dd86d36d)), closes [#369](https://github.com/Jaal-Yantra-Textiles/v2/issues/369)
* **partner:** attach custom domains as www+apex pairs (roadmap [#17](https://github.com/Jaal-Yantra-Textiles/v2/issues/17)) ([e808709](https://github.com/Jaal-Yantra-Textiles/v2/commit/e808709c610a80d6fba34995dc5e8c8a886a0960))
* **storefront:** credit the New York Gallery open archive on /gallery ([db81e38](https://github.com/Jaal-Yantra-Textiles/v2/commit/db81e38fe729d2c3c5fb704895d81b3e35c737ef))
* **scripts:** one-off to pin NEXT_PUBLIC_BASE_URL on provisioned storefronts ([c628f69](https://github.com/Jaal-Yantra-Textiles/v2/commit/c628f699f872a20fe5228330f41b00392b817fc9)), closes [#374](https://github.com/Jaal-Yantra-Textiles/v2/issues/374)

# [13.27.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v13.26.3...v13.27.0) (2026-06-10)


### Features

* **production-runs:** centralize run transitions in ProductionPolicyService ([75120d2](https://github.com/Jaal-Yantra-Textiles/v2/commit/75120d2921369fec4bb43883e5d7443190ecc112))

## [13.26.3](https://github.com/Jaal-Yantra-Textiles/v2/compare/v13.26.2...v13.26.3) (2026-06-09)

## [13.26.2](https://github.com/Jaal-Yantra-Textiles/v2/compare/v13.26.1...v13.26.2) (2026-06-08)

## [13.26.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v13.26.0...v13.26.1) (2026-06-08)


### Bug Fixes

* **partner:** guard v1 /complete on cancelled assignment; drop dead v1 UI; cover v2 run guard ([4f86ff3](https://github.com/Jaal-Yantra-Textiles/v2/commit/4f86ff35d1aa7eff49f0678e23abd8b22886252c)), closes [#1](https://github.com/Jaal-Yantra-Textiles/v2/issues/1) [#7](https://github.com/Jaal-Yantra-Textiles/v2/issues/7) [#3](https://github.com/Jaal-Yantra-Textiles/v2/issues/3)

# [13.26.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v13.25.0...v13.26.0) (2026-06-07)


### Bug Fixes

* **partner:** cancelled assignment no longer pins a re-assigned design to 'cancelled' ([a8912e7](https://github.com/Jaal-Yantra-Textiles/v2/commit/a8912e71b92e15feb2b13817900684f472f9d93a))
* cancelling a partner assignment also cancels the partner's active runs ([700615c](https://github.com/Jaal-Yantra-Textiles/v2/commit/700615c6d2bb8c4c5840623c542be9345c34e3e6))
* **partner-ui:** convert 3 inline-edit forms to side drawers ([#330](https://github.com/Jaal-Yantra-Textiles/v2/issues/330)) ([6b59e06](https://github.com/Jaal-Yantra-Textiles/v2/commit/6b59e06acb940187c32ef5f47cb8b0aa8b23540e)), closes [#2](https://github.com/Jaal-Yantra-Textiles/v2/issues/2)
* **admin:** convert 3 more inline-edit forms to drawers ([#330](https://github.com/Jaal-Yantra-Textiles/v2/issues/330)) ([524e22b](https://github.com/Jaal-Yantra-Textiles/v2/commit/524e22b4db8dfd8e41d573cde63e4145418f95e6)), closes [#2](https://github.com/Jaal-Yantra-Textiles/v2/issues/2)
* **partner-ui:** design-production-section finish/complete → drawer + focus modal ([#330](https://github.com/Jaal-Yantra-Textiles/v2/issues/330)) ([459f9a3](https://github.com/Jaal-Yantra-Textiles/v2/commit/459f9a380029eaf9c001df3faaecd4030f39cd25)), closes [#2](https://github.com/Jaal-Yantra-Textiles/v2/issues/2)
* **admin:** drop duplicate header in external-platform edit drawer ([731ffd8](https://github.com/Jaal-Yantra-Textiles/v2/commit/731ffd8e34012d16774b7ea9f4d42f37a196fc3a)), closes [#2](https://github.com/Jaal-Yantra-Textiles/v2/issues/2)
* **admin:** partner General section → read view + edit drawer ([#330](https://github.com/Jaal-Yantra-Textiles/v2/issues/330)) ([bf43445](https://github.com/Jaal-Yantra-Textiles/v2/commit/bf43445cbc3fc521908cf78a579e0b43f067dabb)), closes [#2](https://github.com/Jaal-Yantra-Textiles/v2/issues/2)
* **admin:** port Material Usage log form to a side drawer ([#330](https://github.com/Jaal-Yantra-Textiles/v2/issues/330)) ([35182d8](https://github.com/Jaal-Yantra-Textiles/v2/commit/35182d84fed44ed7f6304d64c5fe3ee4a188d5b4)), closes [#2](https://github.com/Jaal-Yantra-Textiles/v2/issues/2)
* **partner-ui:** remove Design ID row from design General section ([84225c7](https://github.com/Jaal-Yantra-Textiles/v2/commit/84225c781133fbfa4e389a79720d3438651d7c71))


### Features

* **admin:** design-detail production-runs summary card + nested page ([#8](https://github.com/Jaal-Yantra-Textiles/v2/issues/8)) ([3e52886](https://github.com/Jaal-Yantra-Textiles/v2/commit/3e5288646d5c9b9ba39e3c34759eb3cfc5c0879e))
* **admin:** design-detail Tasks + Partners summary cards + nested pages ([#8](https://github.com/Jaal-Yantra-Textiles/v2/issues/8)) ([1d632ee](https://github.com/Jaal-Yantra-Textiles/v2/commit/1d632eedf5eeefe1b4765362eb6a13f0bb3f23f3))

# [13.25.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v13.24.0...v13.25.0) (2026-06-07)


### Bug Fixes

* **partner-ui:** BOM crash on object raw_materials + design UX touches ([8bbb307](https://github.com/Jaal-Yantra-Textiles/v2/commit/8bbb307d194739a0ab07ea4133395e7d48bbed4b))
* **production-runs:** complete parent run even without lifecycle txn ([20dd1c4](https://github.com/Jaal-Yantra-Textiles/v2/commit/20dd1c4d0dcf9d940133598bc9b8de5ba0d97d40))
* **partner-designs:** order list by assignment date, newest first ([6bac079](https://github.com/Jaal-Yantra-Textiles/v2/commit/6bac079550011e3eea2c5bbc0626bc44b9ad49d0))
* **admin:** partial server-side search on raw-material categories ([#1](https://github.com/Jaal-Yantra-Textiles/v2/issues/1)) ([3933688](https://github.com/Jaal-Yantra-Textiles/v2/commit/3933688ace52a0013c564467085439c61a1f2582))
* **admin,partner-ui:** raw-material category dropdown clip + analytics nav ([a85d84d](https://github.com/Jaal-Yantra-Textiles/v2/commit/a85d84d722d7f96f07d254e3d973720ab207aa55)), closes [#1](https://github.com/Jaal-Yantra-Textiles/v2/issues/1) [#3](https://github.com/Jaal-Yantra-Textiles/v2/issues/3)
* **admin:** rebuild raw-material category picker on ariakit Combobox ([#1](https://github.com/Jaal-Yantra-Textiles/v2/issues/1)) ([30f29ba](https://github.com/Jaal-Yantra-Textiles/v2/commit/30f29bac76d80a5590e8d92b9583223e537cf106))
* **partner-ui:** use PlaySolid icon (Play not exported by @medusajs/icons) ([3d0fe06](https://github.com/Jaal-Yantra-Textiles/v2/commit/3d0fe060130e0e9707bd4d5e1898bd7815d61cf8)), closes [#323](https://github.com/Jaal-Yantra-Textiles/v2/issues/323)


### Features

* **partner-ui:** design cost panel (roadmap [#6](https://github.com/Jaal-Yantra-Textiles/v2/issues/6) Phase 3 UI) ([cac2cb2](https://github.com/Jaal-Yantra-Textiles/v2/commit/cac2cb29ab46d9c4a6edb65c08b11b63cca3d898))
* **partner-ui:** design create/edit/delete (roadmap [#6](https://github.com/Jaal-Yantra-Textiles/v2/issues/6) Phase 1 UI) ([6272dea](https://github.com/Jaal-Yantra-Textiles/v2/commit/6272dea4deda52588d9506d158802d3524a531f2))
* **partner-ui:** design inventory BOM with SKU + material media (P2 UI) ([a01aa87](https://github.com/Jaal-Yantra-Textiles/v2/commit/a01aa872f98f0b6eae81358778d7d09fb7361f6a))
* **partner-ui:** design self-serve UX fixes — owned designs, raw-material picker, skeletons, command header ([9452143](https://github.com/Jaal-Yantra-Textiles/v2/commit/94521439f60f705e4351beac59938e3ad155080a))
* **partner-ui:** run cost-summary panel (roadmap [#6](https://github.com/Jaal-Yantra-Textiles/v2/issues/6) Phase 5 UI) ([d783cc6](https://github.com/Jaal-Yantra-Textiles/v2/commit/d783cc66b8afc98aa8afa14bf5dc9c0fd83d1959))
* **partner-ui:** start-production run create (roadmap [#6](https://github.com/Jaal-Yantra-Textiles/v2/issues/6) Phase 4 UI) ([88afbe3](https://github.com/Jaal-Yantra-Textiles/v2/commit/88afbe329d7c190f4b5095c7bec554501b14ce99))
* **admin:** warn when assigning a partner with no WhatsApp contact ([#335](https://github.com/Jaal-Yantra-Textiles/v2/issues/335)) ([3119738](https://github.com/Jaal-Yantra-Textiles/v2/commit/311973847b617bb6554cca8aea9a832c3c10c49f)), closes [#25](https://github.com/Jaal-Yantra-Textiles/v2/issues/25)

# [13.24.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v13.23.1...v13.24.0) (2026-06-05)


### Bug Fixes

* **build:** annotate container.resolve() results as any to fix CI build ([042100b](https://github.com/Jaal-Yantra-Textiles/v2/commit/042100b34e8b5a671beb3f36c791ee8e4c4eaa15))
* **tax:** backfill classify dry-run is actually dry + correct partner scope ([c9ca141](https://github.com/Jaal-Yantra-Textiles/v2/commit/c9ca141d9ef37aa105fb5a21cb54faba7e345f26)), closes [#5](https://github.com/Jaal-Yantra-Textiles/v2/issues/5)


### Features

* **designs:** partner cost estimation (roadmap [#6](https://github.com/Jaal-Yantra-Textiles/v2/issues/6) Phase 3) ([a01bd92](https://github.com/Jaal-Yantra-Textiles/v2/commit/a01bd92900a524b236e6b20a9acfb7be291ee428))
* **designs:** partner design ↔ inventory BOM (roadmap [#6](https://github.com/Jaal-Yantra-Textiles/v2/issues/6) Phase 2) ([ac462da](https://github.com/Jaal-Yantra-Textiles/v2/commit/ac462da9c0b54700bad100d7195bb8fe5b031dde))
* **production-runs:** partner run cost-summary, admin parity (roadmap [#6](https://github.com/Jaal-Yantra-Textiles/v2/issues/6) P5) ([9f8e3a3](https://github.com/Jaal-Yantra-Textiles/v2/commit/9f8e3a3885e899bd7d0044cfb7eba699ff17ae7e))
* **production-runs:** partner-originated self-approved runs (roadmap [#6](https://github.com/Jaal-Yantra-Textiles/v2/issues/6) P4) ([18ddc12](https://github.com/Jaal-Yantra-Textiles/v2/commit/18ddc1260e316bd71e0dceb0b34cca0469b84177))

## [13.23.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v13.23.0...v13.23.1) (2026-06-05)


### Bug Fixes

* **consumption-log:** add missing production_run_id column (repair) ([f95acd5](https://github.com/Jaal-Yantra-Textiles/v2/commit/f95acd5cc747ffbd368de16c2c5964855f7e4cd9))

# [13.23.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v13.22.0...v13.23.0) (2026-06-05)


### Features

* **designs:** partner-owned design CRUD, isolated (roadmap [#6](https://github.com/Jaal-Yantra-Textiles/v2/issues/6) P1) ([93faf25](https://github.com/Jaal-Yantra-Textiles/v2/commit/93faf25707607b969b3e5dc3fb223a6454833115))

# [13.22.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v13.21.0...v13.22.0) (2026-06-05)


### Features

* **tax:** audit script + e2e test for partner tax coverage ([02c3fbd](https://github.com/Jaal-Yantra-Textiles/v2/commit/02c3fbd48ffae8ba4333d1042e306ea0008497b2)), closes [#261](https://github.com/Jaal-Yantra-Textiles/v2/issues/261)
* **tax:** auto-classify products by INR price for the IN GST split ([4eaabc2](https://github.com/Jaal-Yantra-Textiles/v2/commit/4eaabc2579b1e7d3e490aaa8a7e91896e94cd9e0))
* **tax:** document IN two-tier GST + flag IN-covering partners in audit ([b2f05d0](https://github.com/Jaal-Yantra-Textiles/v2/commit/b2f05d0d36194630613d1c921e223db128242da3)), closes [#5](https://github.com/Jaal-Yantra-Textiles/v2/issues/5)
* **visual-flows:** emit started + failed lifecycle events + admin email ([67a9bb0](https://github.com/Jaal-Yantra-Textiles/v2/commit/67a9bb01ce1842b12b8ed62ba8c619ccc2638af1))

# [13.21.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v13.20.0...v13.21.0) (2026-06-04)


### Bug Fixes

* **production-runs:** accept template_names=null on assignments ([66c4eea](https://github.com/Jaal-Yantra-Textiles/v2/commit/66c4eea78d516322834b1df0456124c603b3fa58))
* **production-runs:** drop explicit auth on cancel route ([201100c](https://github.com/Jaal-Yantra-Textiles/v2/commit/201100c5d2fe672063dcbd32af88b6fb313d67d6))
* **whatsapp:** only forward header_image_url to templates with IMAGE header ([68d0a89](https://github.com/Jaal-Yantra-Textiles/v2/commit/68d0a8902f9347f90260a36ea57d5d7227a741ac))
* **whatsapp:** runtime fallback URL for IMAGE-header templates ([93ab127](https://github.com/Jaal-Yantra-Textiles/v2/commit/93ab1277234a3e8b62fca2c35c99580a364d648f))
* **admin:** skip redundant sendMutation when per-assignment templates used ([cac75bc](https://github.com/Jaal-Yantra-Textiles/v2/commit/cac75bcc6125d4f44a7dda1f0538971b37e08214))
* **whatsapp:** use a reachable brand asset as IMAGE-header fallback ([06786c3](https://github.com/Jaal-Yantra-Textiles/v2/commit/06786c30affa2228c080f636e00aa3e5b1c7446d))


### Features

* **production-runs:** auto-link partners to design on assignment ([b31f093](https://github.com/Jaal-Yantra-Textiles/v2/commit/b31f09351a0ccab9684757145e731098abcf2b0f))

# [13.20.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v13.19.2...v13.20.0) (2026-06-03)


### Features

* **admin:** region partner-coverage widget + share-to-all endpoint ([590c87d](https://github.com/Jaal-Yantra-Textiles/v2/commit/590c87d793fd95b32e7c1ea18c1f0731cbeb7b37))
* **regions:** subscriber propagates new regions to all partners ([6172650](https://github.com/Jaal-Yantra-Textiles/v2/commit/6172650df40cdcb1867e4601ab3b3f09ac81f5b4))

## [13.19.2](https://github.com/Jaal-Yantra-Textiles/v2/compare/v13.19.1...v13.19.2) (2026-06-02)


### Bug Fixes

* **backfill:** pivot fanout script via sales_channel entity ([98f8b9c](https://github.com/Jaal-Yantra-Textiles/v2/commit/98f8b9c9d8c2ab4f4c54b00e2541ac8424cd3c05)), closes [#306](https://github.com/Jaal-Yantra-Textiles/v2/issues/306)

## [13.19.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v13.19.0...v13.19.1) (2026-06-02)


### Bug Fixes

* **backfill:** fanout script multi-hop sales_channels filter ([43e7321](https://github.com/Jaal-Yantra-Textiles/v2/commit/43e7321919c676767ad96914a6f2c74812958bca))

# [13.19.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v13.18.0...v13.19.0) (2026-06-02)


### Features

* **ci:** build-only workflow_dispatch + guard :latest on main ([938e788](https://github.com/Jaal-Yantra-Textiles/v2/commit/938e788ceb8be040c3d102fd90a64bf2d63fb61b))
* **backfill:** cross-product all partners × all admin regions ([c907a7c](https://github.com/Jaal-Yantra-Textiles/v2/commit/c907a7ca1b220dcdc268e748a6b1c880ffb7ac47))
* **backfill:** replay FX fanout across existing variant prices ([13de08a](https://github.com/Jaal-Yantra-Textiles/v2/commit/13de08ad0890f2ca30823573441ef4cd9dc914d1))
* **ops:** run-backfill.sh IMAGE_TAG override ([c43f09e](https://github.com/Jaal-Yantra-Textiles/v2/commit/c43f09e4b909521e591da36623c38fc51a7bcfdd))

# [13.18.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v13.17.1...v13.18.0) (2026-06-01)


### Features

* **whatsapp:** W5 Confirm/Cancel + 24h window guard + language persist ([9522e9f](https://github.com/Jaal-Yantra-Textiles/v2/commit/9522e9f97a80fc9d170673486d582199dd515c71))

## [13.17.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v13.17.0...v13.17.1) (2026-05-31)


### Bug Fixes

* **whatsapp:** single reply for product-create + absolute admin URL ([f3a466b](https://github.com/Jaal-Yantra-Textiles/v2/commit/f3a466bfc5479eea528ccaa1f054d1bc8bf92ef9))

# [13.17.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v13.16.0...v13.17.0) (2026-05-31)


### Bug Fixes

* **visual-flows:** migration 20260531 preserves generate_partner_deeplink ([f96ece2](https://github.com/Jaal-Yantra-Textiles/v2/commit/f96ece2567e3f239723b349a67b0fee2049d00f1)), closes [#298](https://github.com/Jaal-Yantra-Textiles/v2/issues/298)


### Features

* **whatsapp:** accept document type in product-create flow + roadmap items ([f880165](https://github.com/Jaal-Yantra-Textiles/v2/commit/f8801651b6be9a00cd289d61532a5527927bdbc5)), closes [#21](https://github.com/Jaal-Yantra-Textiles/v2/issues/21) [#22](https://github.com/Jaal-Yantra-Textiles/v2/issues/22) [#23](https://github.com/Jaal-Yantra-Textiles/v2/issues/23)
* **whatsapp:** createDraftProductFromExtractionWorkflow (W2) ([ad7af96](https://github.com/Jaal-Yantra-Textiles/v2/commit/ad7af96339895e495b40d71f71ef94eb9941a879))

# [13.16.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v13.15.0...v13.16.0) (2026-05-31)


### Bug Fixes

* **visual-flows:** add ai_extract_platform to operation_type enum + migration ([127b237](https://github.com/Jaal-Yantra-Textiles/v2/commit/127b237beb1e801b7746f4609655db51ce67d97f)), closes [#297](https://github.com/Jaal-Yantra-Textiles/v2/issues/297)
* **scripts:** seed-partner-page-fixtures uses correct workflow result shape ([f78e07d](https://github.com/Jaal-Yantra-Textiles/v2/commit/f78e07dac001089833e002e44ce8a663dbd393b7)), closes [#291](https://github.com/Jaal-Yantra-Textiles/v2/issues/291) [#291](https://github.com/Jaal-Yantra-Textiles/v2/issues/291) [#294](https://github.com/Jaal-Yantra-Textiles/v2/issues/294) [#295](https://github.com/Jaal-Yantra-Textiles/v2/issues/295)


### Features

* **whatsapp:** emit whatsapp.message_received event from webhook (W3) ([4444d34](https://github.com/Jaal-Yantra-Textiles/v2/commit/4444d3479d3f82c834f974708b1f35cfd9f0a5a0))
* **visual-flows:** platform-aware ai_extract_platform operation ([f89994c](https://github.com/Jaal-Yantra-Textiles/v2/commit/f89994cf5d9f758fde1593fe4a8c4c57a5fa6fa4))
* **whatsapp:** seed Partner WhatsApp Product Create visual flow (W4) ([319551f](https://github.com/Jaal-Yantra-Textiles/v2/commit/319551fe530c7ce67f26a9fd1dba61e481452b4d))

# [13.15.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v13.14.0...v13.15.0) (2026-05-27)


### Bug Fixes

* **chat:** declare AI SDK extra fields explicitly (Medusa forces .strict) ([0bf1c92](https://github.com/Jaal-Yantra-Textiles/v2/commit/0bf1c920338d08d4ba8e43363de30320e6b77b35)), closes [#289](https://github.com/Jaal-Yantra-Textiles/v2/issues/289)
* **storefront-chat:** passthrough validator + full-width input + z + focus ([f0787e4](https://github.com/Jaal-Yantra-Textiles/v2/commit/f0787e4d1d871905789b45723597804594a02291))
* **pages:** published_at silently overwritten + draft pages stamped ([fbaaaad](https://github.com/Jaal-Yantra-Textiles/v2/commit/fbaaaadad16a127acef41e6d4982178e298453ed)), closes [#1](https://github.com/Jaal-Yantra-Textiles/v2/issues/1)
* **blocks:** PUT response returned wrong block (same shape as [#285](https://github.com/Jaal-Yantra-Textiles/v2/issues/285)) ([b88dde3](https://github.com/Jaal-Yantra-Textiles/v2/commit/b88dde37b8dd1b63f5a65dc52d74f36707e3ecc4))
* **pages:** TS overload mismatch on createPages (published_at coercion) ([3d4980b](https://github.com/Jaal-Yantra-Textiles/v2/commit/3d4980bcaf085c6815d37c8630d48b2aa29dffe3))


### Features

* **marketing:** add intent + traffic to /marketing/metrics ([4bf4784](https://github.com/Jaal-Yantra-Textiles/v2/commit/4bf47840a89c9d6a68feaf6798457ab88b51482f)), closes [#284](https://github.com/Jaal-Yantra-Textiles/v2/issues/284)

# [13.14.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v13.13.0...v13.14.0) (2026-05-27)


### Bug Fixes

* **stats:** blog injector + REST endpoint share public/exclude rules ([e076b3b](https://github.com/Jaal-Yantra-Textiles/v2/commit/e076b3b0d6972df999ab4489d18e1215b57d2dff)), closes [#281](https://github.com/Jaal-Yantra-Textiles/v2/issues/281)
* **marketing:** classify live brands by storefront, not workspace_type ([#276](https://github.com/Jaal-Yantra-Textiles/v2/issues/276)) ([550ee6f](https://github.com/Jaal-Yantra-Textiles/v2/commit/550ee6f293582d04fd4895d536aca7dea1ebb2f9))
* **stats:** drop public-gate on blog injector (admin authoring is the auth) ([39f0ecd](https://github.com/Jaal-Yantra-Textiles/v2/commit/39f0ecd59d52d09bd105e5f56e52903e6311d309)), closes [#281](https://github.com/Jaal-Yantra-Textiles/v2/issues/281)
* **fx:** real fanout trigger + ui badge + delete-fx-meta auth + scoping ([#271](https://github.com/Jaal-Yantra-Textiles/v2/issues/271)) ([9234ba0](https://github.com/Jaal-Yantra-Textiles/v2/commit/9234ba09f81f4a5fc9f0f790404eb9a1f8783333)), closes [#269](https://github.com/Jaal-Yantra-Textiles/v2/issues/269)
* **partner-api:** restore validateAndTransformQuery on region routes ([#278](https://github.com/Jaal-Yantra-Textiles/v2/issues/278)) ([477e1e9](https://github.com/Jaal-Yantra-Textiles/v2/commit/477e1e94ad496ee34a355b103150b4699eeda8b1)), closes [#271](https://github.com/Jaal-Yantra-Textiles/v2/issues/271)


### Features

* **theme:** accept text_color on trust_banner + banner ([09620a0](https://github.com/Jaal-Yantra-Textiles/v2/commit/09620a05b1a5be1088c5a04c039aeaf1c4988fb1))
* **fx:** daily re-rate auto-converted prices workflow + visual flow (G5) ([#272](https://github.com/Jaal-Yantra-Textiles/v2/issues/272)) ([1116c74](https://github.com/Jaal-Yantra-Textiles/v2/commit/1116c74c3cabd34aebb2a09f5ee095d8a1e8a9ab))
* **stats:** pagination + column include/exclude on panels ([8885f71](https://github.com/Jaal-Yantra-Textiles/v2/commit/8885f7112683d0feae05e0c3cd2e181ed9a420d7))
* **web:** public contact endpoint for atlas map ([#275](https://github.com/Jaal-Yantra-Textiles/v2/issues/275)) ([7a41230](https://github.com/Jaal-Yantra-Textiles/v2/commit/7a41230d9d016d9bcc88e93fedd7ad21b9bc6d2f))
* **web:** public GET /web/stats/panels/:id/data for blog embeds ([7531017](https://github.com/Jaal-Yantra-Textiles/v2/commit/75310174cb72ed27ed92a80efe9ef111070e5eb4))
* **partners:** revalidate storefront cache on theme update ([3c59edd](https://github.com/Jaal-Yantra-Textiles/v2/commit/3c59edd5dcf814188ca1ddda13ef4aca4bf79385))
* **fx:** storefront RegionNotServedFallback + contact endpoint (PR H) ([#273](https://github.com/Jaal-Yantra-Textiles/v2/issues/273)) ([d2b289a](https://github.com/Jaal-Yantra-Textiles/v2/commit/d2b289ae5bf77ada0375781e05b809d91d2db3e5))

# [13.13.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v13.12.1...v13.13.0) (2026-05-26)


### Bug Fixes

* **fx:** replace price.metadata stuffing with fx_price_meta link table ([#269](https://github.com/Jaal-Yantra-Textiles/v2/issues/269)) ([7867aa0](https://github.com/Jaal-Yantra-Textiles/v2/commit/7867aa03a89b8721a1318f444783f7db402bb682))


### Features

* **fx:** fanout subscriber + workflow on variant price create (PR G3) ([#265](https://github.com/Jaal-Yantra-Textiles/v2/issues/265)) ([d0590dd](https://github.com/Jaal-Yantra-Textiles/v2/commit/d0590dd3d1b13254e41ecb82a3f29e949e58ae3b))
* **fx:** partner-ui FX badge on auto-converted price cells (G4a) ([#268](https://github.com/Jaal-Yantra-Textiles/v2/issues/268)) ([e0a496a](https://github.com/Jaal-Yantra-Textiles/v2/commit/e0a496a783440b05faf177b0e20c0aa4b4665125))
* **fx:** partner-ui strip-on-edit + store auto-convert toggle (G4b) ([#270](https://github.com/Jaal-Yantra-Textiles/v2/issues/270)) ([4691e1a](https://github.com/Jaal-Yantra-Textiles/v2/commit/4691e1ac93aba7cf2c20004d440f0c49f3211d62)), closes [#269](https://github.com/Jaal-Yantra-Textiles/v2/issues/269) [#269](https://github.com/Jaal-Yantra-Textiles/v2/issues/269) [post-#269](https://github.com/post-/issues/269)

## [13.12.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v13.12.0...v13.12.1) (2026-05-26)


### Bug Fixes

* **prod-config:** register fx_rates module in medusa-config.prod.ts ([#266](https://github.com/Jaal-Yantra-Textiles/v2/issues/266)) ([afad332](https://github.com/Jaal-Yantra-Textiles/v2/commit/afad3323a34f60f3c784f9545572a32cfce65771)), closes [#263](https://github.com/Jaal-Yantra-Textiles/v2/issues/263)

# [13.12.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v13.11.1...v13.12.0) (2026-05-26)


### Features

* **fx:** new fx_rates module + open.er-api.com fetcher + seed script (PR G1) ([398d435](https://github.com/Jaal-Yantra-Textiles/v2/commit/398d4354960c1811fb1a1a392fce507389913b6d)), closes [#262](https://github.com/Jaal-Yantra-Textiles/v2/issues/262) [#259](https://github.com/Jaal-Yantra-Textiles/v2/issues/259)
* **fx:** refresh-fx-rates workflow + daily visual flow seed (PR G2) ([98c605e](https://github.com/Jaal-Yantra-Textiles/v2/commit/98c605e0e7dc79b50ffae382a61c68d118012b74)), closes [#259](https://github.com/Jaal-Yantra-Textiles/v2/issues/259)

## [13.11.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v13.11.0...v13.11.1) (2026-05-25)


### Bug Fixes

* **scripts:** backfills + tax-seed honor DRY_RUN env var (not just --dry-run arg) ([edfbbc8](https://github.com/Jaal-Yantra-Textiles/v2/commit/edfbbc8d938cc1dc79f56fbae49b2658419c8647)), closes [#259](https://github.com/Jaal-Yantra-Textiles/v2/issues/259) [#261](https://github.com/Jaal-Yantra-Textiles/v2/issues/261)

# [13.11.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v13.10.2...v13.11.0) (2026-05-25)


### Bug Fixes

* **stores:** createRegionStep matches by country AND currency ([3e2db0c](https://github.com/Jaal-Yantra-Textiles/v2/commit/3e2db0ce3847b1f32cdb21a75eedbeca887996a3)), closes [#257](https://github.com/Jaal-Yantra-Textiles/v2/issues/257) [#257](https://github.com/Jaal-Yantra-Textiles/v2/issues/257)
* **partner-api:** refuse clone-on-write when shared region has countries ([eeba41a](https://github.com/Jaal-Yantra-Textiles/v2/commit/eeba41a2d5b558da4135f9b9c1098e8c116db95f))
* **partner-ui:** region + tax-region hooks actually send query params ([55a7fef](https://github.com/Jaal-Yantra-Textiles/v2/commit/55a7fef0cf68566a3c57870d8110b2ecba44a698))
* **partner-ui:** region create/edit pickers show all currencies ([5c1e237](https://github.com/Jaal-Yantra-Textiles/v2/commit/5c1e2372dd8002634bcfe487d8fec05db1c4a34e))
* **partner-api:** region list reuses admin's validator + query-config (no max-limit cap) ([f7605be](https://github.com/Jaal-Yantra-Textiles/v2/commit/f7605be97ea080f3e6889d4e6b044a0b1bebb496))
* **partner-api:** supported_currencies auto-expand uses updateStoresWorkflow + helpers.ts loads relation ([10608c6](https://github.com/Jaal-Yantra-Textiles/v2/commit/10608c688161ed374c1838d6a040eaba517118de))
* **partner-api:** tax-region list honors parent_id (and friends) from query ([c4a774a](https://github.com/Jaal-Yantra-Textiles/v2/commit/c4a774a88f8795362ca8e5e97be7464e3efa40de))
* **partner-api:** tax-region list reuses admin's validator + middleware ([8e6c1bf](https://github.com/Jaal-Yantra-Textiles/v2/commit/8e6c1bf0fe28df6373a3b39a0adef2807567e2b1))
* **partner-api:** tax-region list+create lowercase country/province codes ([2761b50](https://github.com/Jaal-Yantra-Textiles/v2/commit/2761b5019d2d2860fae56439a62cce6416e43793))
* **partner-api:** tax-region NULL filter uses \$eq operator form ([266217a](https://github.com/Jaal-Yantra-Textiles/v2/commit/266217ae93072c031ab8bf6dd3762cb8110b73c9))


### Features

* **partner-api:** auto-expand store.supported_currencies on region create/update ([7e94fd5](https://github.com/Jaal-Yantra-Textiles/v2/commit/7e94fd5f7192ed7351d38bc5317962bc7c551ca3))
* **scripts:** backfill partner_region links from store.default_region_id ([caafae7](https://github.com/Jaal-Yantra-Textiles/v2/commit/caafae718b2a01dfd71d2d64330cb814e5ee8254))
* **partner-api:** clone-on-write copies shipping-option region prices ([a6de176](https://github.com/Jaal-Yantra-Textiles/v2/commit/a6de176e21faa74710dc638442125be8ee01be83))
* **partner-api:** enrich region list with payment_providers + stamp partner provenance ([e6fb8ca](https://github.com/Jaal-Yantra-Textiles/v2/commit/e6fb8ca24ec554410339a46d0dd912460ae44077))
* **partner-api:** GET /partners/stores/:id/payment-providers ([7fe4383](https://github.com/Jaal-Yantra-Textiles/v2/commit/7fe43834dd572c104aaa13efb3f1e8dee4601b25))
* **partner-ui:** info banner above partner region list ([3fed9da](https://github.com/Jaal-Yantra-Textiles/v2/commit/3fed9dafde5d0f241542612723c50e59112d9a25)), closes [#259](https://github.com/Jaal-Yantra-Textiles/v2/issues/259) [#259](https://github.com/Jaal-Yantra-Textiles/v2/issues/259)
* **partner-api:** ref-counted region DELETE ([6808f4e](https://github.com/Jaal-Yantra-Textiles/v2/commit/6808f4ea61092bd22a6b225e9d61c2c2ee0a6fef)), closes [#257](https://github.com/Jaal-Yantra-Textiles/v2/issues/257)
* **partner-api:** region GET handlers use middleware-set queryConfig ([f16d702](https://github.com/Jaal-Yantra-Textiles/v2/commit/f16d7025e621b5f3ad3b7b69cfebff629d6338d5))
* **partner-api:** region update via workflow + clone-on-write on shared rows ([0ac4e08](https://github.com/Jaal-Yantra-Textiles/v2/commit/0ac4e08a7237bb081cf49b5ff943fd5b90fc7f91)), closes [#257](https://github.com/Jaal-Yantra-Textiles/v2/issues/257) [#257](https://github.com/Jaal-Yantra-Textiles/v2/issues/257)
* **partner-api:** region validators mirror admin shape ([b55e1ef](https://github.com/Jaal-Yantra-Textiles/v2/commit/b55e1efb3a4dcf724fea719abf8ccd80890927bc))
* **scripts:** seed canonical tax_regions for every admin region's countries ([052e443](https://github.com/Jaal-Yantra-Textiles/v2/commit/052e4438941b9b9261a9d3db531563f9284f2733)), closes [#259](https://github.com/Jaal-Yantra-Textiles/v2/issues/259)
* **partner-ui:** tax-region create exposes is_combinable + province_code ([4874f37](https://github.com/Jaal-Yantra-Textiles/v2/commit/4874f3732d84017dcaf555f29a8bfd9cb4f25a28))
* **partner-api:** wire region query middleware (parity scaffolding) ([5c440ee](https://github.com/Jaal-Yantra-Textiles/v2/commit/5c440eec753d98d26239d40fad85fdd72e43d38d))

## [13.10.2](https://github.com/Jaal-Yantra-Textiles/v2/compare/v13.10.1...v13.10.2) (2026-05-24)


### Bug Fixes

* **partner-api:** order/return/shipping-option field-shape crashes ([53531ea](https://github.com/Jaal-Yantra-Textiles/v2/commit/53531ea1291716cbaf930e8c4f585e5dfd767cad))
* **partner:** orders list relations + country column + plugins query ([a11fc52](https://github.com/Jaal-Yantra-Textiles/v2/commit/a11fc520e0403f3adc4c209e736569d8af4271ee))

## [13.10.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v13.10.0...v13.10.1) (2026-05-23)


### Bug Fixes

* **partner-api:** accept provider_id on tax-region create ([774c825](https://github.com/Jaal-Yantra-Textiles/v2/commit/774c8254823668d1aa429b8f086b3d9374c83789))
* **partner-api:** expand price_rules so region prices render in pricing grid ([e94d802](https://github.com/Jaal-Yantra-Textiles/v2/commit/e94d8028ee36a33c6b0f577284c3af64d663dc0b))
* **partner-api:** persist prices on shipping-option update ([bc1610b](https://github.com/Jaal-Yantra-Textiles/v2/commit/bc1610b51c70399973573aaf75df429deb7e0218))
* **partner-api:** persist stocked_quantity on level update ([51e99ae](https://github.com/Jaal-Yantra-Textiles/v2/commit/51e99ae3c6158569273c457eb5237bec600fe9d9))
* **partner-api:** route variant create/update through workflows ([2115875](https://github.com/Jaal-Yantra-Textiles/v2/commit/21158755d50a4d9e1ce2afa091f9b4b8cbfdde67))
* **partner-api:** seed inventory_level rows for new variants ([95ec961](https://github.com/Jaal-Yantra-Textiles/v2/commit/95ec961a1257e536dbef9dff63220e9e31a8e820))

# [13.10.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v13.9.0...v13.10.0) (2026-05-22)


### Features

* **storefront/chat:** onboarding as full-viewport focus modal + exit prompt ([d04199f](https://github.com/Jaal-Yantra-Textiles/v2/commit/d04199f23b81df3a46b7d6709c5369aa1a4ea450))

# [13.9.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v13.8.0...v13.9.0) (2026-05-22)


### Bug Fixes

* **storefront/chat-onboarding:** scroll the middle content on big screens ([bf34570](https://github.com/Jaal-Yantra-Textiles/v2/commit/bf345707a488c518afb97801acd66b571e895da3))


### Features

* **storefront/hero:** album-backed painting + centred chat search bar ([cdde428](https://github.com/Jaal-Yantra-Textiles/v2/commit/cdde4282762228bb6791843362dbefc9c1fee84f))

# [13.8.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v13.7.0...v13.8.0) (2026-05-22)


### Bug Fixes

* **productCatalog:** cap embed batch at 10 to satisfy DashScope limit ([686cc35](https://github.com/Jaal-Yantra-Textiles/v2/commit/686cc351771e1bb79fa31de4bd1b4b9425475041))
* **store/ai/search:** drop calculated_price fields pending pricing context ([8be2417](https://github.com/Jaal-Yantra-Textiles/v2/commit/8be241742ee5e0cd53a30fcf4e90fe528ac0bef7))
* **storefront/chat-modal:** scroll behaviour + friendlier reply copy ([ef8a292](https://github.com/Jaal-Yantra-Textiles/v2/commit/ef8a292db4964bab59d89e185f4b7ff8874093c9))


### Features

* **storefront:** chat-modal search at home + inline product search on /store ([6ffd5ed](https://github.com/Jaal-Yantra-Textiles/v2/commit/6ffd5edf21640877165ce32794996ce3d6b393ed))
* **storefront/chat-agent:** streaming concierge with onboarding + brand corpus ([c636a66](https://github.com/Jaal-Yantra-Textiles/v2/commit/c636a66e0d3c8444ebe8d6c32c608a24353d71ef))

# [13.7.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v13.6.0...v13.7.0) (2026-05-21)


### Bug Fixes

* **ai-search:** hard timeout + PgVector id + inline encrypt + AI filter ([00434e7](https://github.com/Jaal-Yantra-Textiles/v2/commit/00434e7ab38f74800e9fb3c7498b768593dbfbe7))
* **storefront/search:** route AI search through a server action ([36adfb8](https://github.com/Jaal-Yantra-Textiles/v2/commit/36adfb8f23c4d0dfea6dde64fc4aa5c33ba3f990))


### Features

* **ai:** Create-AI-provider admin UI + env-vars backfill script ([469adc1](https://github.com/Jaal-Yantra-Textiles/v2/commit/469adc1c1ce3728477b2a648a3f5897a3dac3b12)), closes [#242](https://github.com/Jaal-Yantra-Textiles/v2/issues/242)
* **store/ai/search:** free OpenRouter → DashScope → CF Workers AI chain ([bf0ebb9](https://github.com/Jaal-Yantra-Textiles/v2/commit/bf0ebb9d5d7a68060663fb60826714660811300b))
* **ai:** lookup AI provider config from external-platforms (env fallback) ([bf67d95](https://github.com/Jaal-Yantra-Textiles/v2/commit/bf67d954262870c75d0b451e8d154a3bf5396dc7))
* **ai:** migrate FAL_KEY to External Platforms (new role ai_image_gen) ([203b081](https://github.com/Jaal-Yantra-Textiles/v2/commit/203b081e3e0cf64ab08c3c48f118af2682225939))
* **storefront/home:** one-shot hero + responsive coming-soon search ([7bc5bba](https://github.com/Jaal-Yantra-Textiles/v2/commit/7bc5bbaf03bf353fddafee8853363326a35ba7e5))
* **store/ai/search:** partner-storefront attribution + CF embeddings ([c06ddaf](https://github.com/Jaal-Yantra-Textiles/v2/commit/c06ddaff67ca6cae0963fad25f67a07111625a7e))
* **store/ai:** semantic product search backed by PgVector ([1348450](https://github.com/Jaal-Yantra-Textiles/v2/commit/1348450def2c8ca94a74b90db3cb77fd90b84866))
* **storefront/home:** wire natural-language product search ([a1a30e9](https://github.com/Jaal-Yantra-Textiles/v2/commit/a1a30e904bd0c3ace8bcead1e455350b7db95ac9))

# [13.6.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v13.5.0...v13.6.0) (2026-05-20)


### Bug Fixes

* **admin/inventory:** accept fields query param on raw-materials list ([1538b24](https://github.com/Jaal-Yantra-Textiles/v2/commit/1538b24bce0d82ba4a832d3970f15ddeb455a5eb))
* **lockfile:** add deploy/cloudflare importer entry ([3c3a9b9](https://github.com/Jaal-Yantra-Textiles/v2/commit/3c3a9b965cee9482f36a5dfbfd6349d9fb172163))
* **desk:** always mount Layout, overlay EmptyDesk on top when empty ([832d4e9](https://github.com/Jaal-Yantra-Textiles/v2/commit/832d4e92c155cefaf258a77f2c39892376609e9f))
* **desk:** bump localStorage key to v2 to drop broken-period blobs ([62b75e9](https://github.com/Jaal-Yantra-Textiles/v2/commit/62b75e925778bc6ea6107d95a7dd0ff5923d1de6))
* **desk:** derive empty state from model, not the active-tab-store ([361deb0](https://github.com/Jaal-Yantra-Textiles/v2/commit/361deb09e8f45c62b72bef8d300459351c6c2c21))
* **deploy:** lock manifest to deployed prod state (rev:6) ([7af3604](https://github.com/Jaal-Yantra-Textiles/v2/commit/7af3604c58c1cf7712b85f48c7e21944fa2e4f81))
* **ci:** lowercase GHCR image + pin sha as primary tag ([c93b1d5](https://github.com/Jaal-Yantra-Textiles/v2/commit/c93b1d56a5bd7eb914ded6f30ab9dbdc591e1a29))
* **partner-ui:** migrate to zod v4 (broken by backend 2.15.2 bump) ([1df678b](https://github.com/Jaal-Yantra-Textiles/v2/commit/1df678be1d2844b9afd66af68b2f37a49f147a67))
* **docs:** pin react-router inside v5 react-router-dom subtree ([2470dd9](https://github.com/Jaal-Yantra-Textiles/v2/commit/2470dd9386d7f7111f37d2c4404798b550603674))
* **ci:** unblock copilot svc deploy in CI ([55a1933](https://github.com/Jaal-Yantra-Textiles/v2/commit/55a1933db2312f9948fcd24e5472f7624a92328c)), closes [#237](https://github.com/Jaal-Yantra-Textiles/v2/issues/237)
* **ci:** use --force on copilot svc deploy so ECS actually rolls tasks ([6cde967](https://github.com/Jaal-Yantra-Textiles/v2/commit/6cde96762dd2ca32218f501446e06ce9baed6afc)), closes [#239](https://github.com/Jaal-Yantra-Textiles/v2/issues/239)


### Features

* **desk:** Alt+W keyboard shortcut to close active tab ([693297d](https://github.com/Jaal-Yantra-Textiles/v2/commit/693297df9d3fc86c79f79bce02df308278ef7466))
* **ci:** auto-deploy to AWS ECS on push to main ([bf3b7c8](https://github.com/Jaal-Yantra-Textiles/v2/commit/bf3b7c852ced11e3e82716770fa20a14a19dc697))
* **deploy:** AWS ECS Fargate infrastructure (Phase 0) ([8cf04d9](https://github.com/Jaal-Yantra-Textiles/v2/commit/8cf04d97c1a0af796f991e5e5ba356601179cf9b)), closes [#1](https://github.com/Jaal-Yantra-Textiles/v2/issues/1)
* **desk:** cross-tab open helper (openTabAt) ([a9d7c27](https://github.com/Jaal-Yantra-Textiles/v2/commit/a9d7c27189aa251ec9999e047e653b668930a4ef))
* **desk:** persist workspace UI to db via user.metadata ([b06c76c](https://github.com/Jaal-Yantra-Textiles/v2/commit/b06c76c02439ce8eadbccb375566fbeaea03c72c))
* **desk:** versioned persistence + save-failed toast + reset action ([d0e861f](https://github.com/Jaal-Yantra-Textiles/v2/commit/d0e861f566da46e5d14b29a81cdf3006243e30c2))
* **deploy:** wire ECS deploy events + email alerts to SNS ([6ff3e65](https://github.com/Jaal-Yantra-Textiles/v2/commit/6ff3e6522cf6f68273d190f692dcd923cad36090))

# [13.5.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v13.4.0...v13.5.0) (2026-05-14)


### Bug Fixes

* **theme-editor:** close live-preview gaps for footer + home-section panels ([3347028](https://github.com/Jaal-Yantra-Textiles/v2/commit/33470289156a493f593937595edafeea2b59a13d))
* **partners:** default variant title falls back to product title ([24bd47d](https://github.com/Jaal-Yantra-Textiles/v2/commit/24bd47dcf818256219bbc4f742b5e78ef9b14c01))
* **website:** make page-by-domain lookup honor aliases + partner fallback ([8926513](https://github.com/Jaal-Yantra-Textiles/v2/commit/892651393c1475e429e39a8972a6a601508216ba))
* **store:** override /store/products to bypass index engine for category/tag ([12ea843](https://github.com/Jaal-Yantra-Textiles/v2/commit/12ea8438c55dadb36701937a551f10bc9651af75))
* **partner-ui:** redirect to /product-types after creating a type ([4866de5](https://github.com/Jaal-Yantra-Textiles/v2/commit/4866de558188c55dc5936d79711e335b4bbbe119))
* **store:** satisfy TS in /store/products getProducts override ([fb3a95d](https://github.com/Jaal-Yantra-Textiles/v2/commit/fb3a95d6cd75986c44ac5cf4ca3976dcfbccae70))
* **partners:** scope product-collection handle per store ([95be014](https://github.com/Jaal-Yantra-Textiles/v2/commit/95be0144e4e9b3dbc1882f61d784948285546db3))


### Features

* **theme-editor:** add editor panels for the 5 home sub-sections + a real sections-order UI ([02ce894](https://github.com/Jaal-Yantra-Textiles/v2/commit/02ce894643810a4b1d98ad859fb2f8e9ebb11a64))
* **theme-editor:** lift InlinePreview overlay for product_page and cart ([6a98619](https://github.com/Jaal-Yantra-Textiles/v2/commit/6a9861940d63a6a56cb7e0e5f202b086e01c45b4))

# [13.4.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v13.3.0...v13.4.0) (2026-05-13)


### Bug Fixes

* **partner-subscription:** correct PayU hash + gate plan activation on verification ([d970f98](https://github.com/Jaal-Yantra-Textiles/v2/commit/d970f98b81cc5c08fb012aec3b8dc7a8bcc70c76))
* **partner-storefront:** read columns first, strip legacy metadata on write ([f3628cb](https://github.com/Jaal-Yantra-Textiles/v2/commit/f3628cbb2576a9b9e0f79ac2712e2ca00c68a009))


### Features

* **partner-storefront:** apply Vercel's recommended DNS via Cloudflare ([7ebb4a5](https://github.com/Jaal-Yantra-Textiles/v2/commit/7ebb4a5edff6f80e8a8b64c70d6d031381acfb92))

# [13.3.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v13.2.0...v13.3.0) (2026-05-12)


### Bug Fixes

* **admin:** hide ad-planning sub-routes from sidebar + add missing Goals card ([40ab83d](https://github.com/Jaal-Yantra-Textiles/v2/commit/40ab83d59fb9c06914ec095f7830586377c38a76))


### Features

* **admin:** /admin/operations hub gathers reporting + tools behind one entry ([dfac85d](https://github.com/Jaal-Yantra-Textiles/v2/commit/dfac85db2bc7f4651d04f9a6023ce4ad04f0359b))
* **admin:** 3 more hubs — Production, Audience, Content — + equal-height cards ([a43de4d](https://github.com/Jaal-Yantra-Textiles/v2/commit/a43de4dbfa6f42618e216cee4ee3b9a9f245637e))
* **search-console:** per-website Google Search Console view + sync ([3b50af7](https://github.com/Jaal-Yantra-Textiles/v2/commit/3b50af7d982227d2bbed6aea60febe30c53fd3a7)), closes [#218](https://github.com/Jaal-Yantra-Textiles/v2/issues/218)

# [13.2.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v13.1.1...v13.2.0) (2026-05-12)


### Bug Fixes

* **google-ads:** surface Test-access dev token + specific error codes on sync 403 ([3996532](https://github.com/Jaal-Yantra-Textiles/v2/commit/399653294478e613d77e4d0ec1e5fda347fdb472))


### Features

* **ads:** generalize Meta Ads surface to /admin/ads/* + enrich Google sync ([1bf07a6](https://github.com/Jaal-Yantra-Textiles/v2/commit/1bf07a6f2a17a8a643a9a395528afe2f83292e10))
* **admin:** unified /admin/ads UI for Meta + Google ([5acb99f](https://github.com/Jaal-Yantra-Textiles/v2/commit/5acb99fb1c9e55841bf4799292cc66fc326a753e)), closes [#215](https://github.com/Jaal-Yantra-Textiles/v2/issues/215)

## [13.1.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v13.1.0...v13.1.1) (2026-05-12)


### Bug Fixes

* **google-ads:** send login-customer-id so child CIDs under an MCC stop 403'ing ([685bbd5](https://github.com/Jaal-Yantra-Textiles/v2/commit/685bbd59010c65f4a1df030772513ea21e86ec7c))

# [13.1.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v13.0.0...v13.1.0) (2026-05-11)


### Bug Fixes

* **cors:** also allow registered website + alias domains from DB ([703e92d](https://github.com/Jaal-Yantra-Textiles/v2/commit/703e92dc93594e521f09f4943a0a7201e465e557)), closes [#211](https://github.com/Jaal-Yantra-Textiles/v2/issues/211)
* **cors:** auto-allow *.ROOT_DOMAIN in /web + /partners middlewares ([3426f53](https://github.com/Jaal-Yantra-Textiles/v2/commit/3426f5357f3461cb9b3932fe5fcdfc81fae8883f))


### Features

* **marketing:** hubs from stock_location + lead_time from production_runs ([6fb77af](https://github.com/Jaal-Yantra-Textiles/v2/commit/6fb77af6388141b37fcd3901e5c118c1d561fa03))
* **marketing-seed:** seed 'contact' form handle for jyt-web /contact page ([991542e](https://github.com/Jaal-Yantra-Textiles/v2/commit/991542e1610ab56d640a3d255ce279c6ddfad03c))

# [13.0.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v12.15.0...v13.0.0) (2026-05-11)


### Bug Fixes

* [DX-1030] State/province should not be required during checkout ([f337acd](https://github.com/Jaal-Yantra-Textiles/v2/commit/f337acd3b717c6b23b64d5af5c72af1128c08920))
* [dx-1035] Changing password breaks the application ([97a9490](https://github.com/Jaal-Yantra-Textiles/v2/commit/97a94901a7a23c43feb984583a5012f4c624b473))
* [DX-1036] Updating billing address always fails ([710a3b9](https://github.com/Jaal-Yantra-Textiles/v2/commit/710a3b9a501d9f4b5b9efbb7665098cb77051b30))
* [dx-1037] Prices of taxes are not included in Shipping prices ([b74bcd1](https://github.com/Jaal-Yantra-Textiles/v2/commit/b74bcd12cf97535acb0b63f837e110206db887c2))
* [dx-1038] add isValidVariant check ([5764b44](https://github.com/Jaal-Yantra-Textiles/v2/commit/5764b4463833f8538a3d632979a6702e33b8f31f))
* 404 state ([10df152](https://github.com/Jaal-Yantra-Textiles/v2/commit/10df1524610411737fea0c18ae9d3948bb75c7ad))
* add cookie security ([5bd6da7](https://github.com/Jaal-Yantra-Textiles/v2/commit/5bd6da741630b4de2f357e09b8baeb764251da10))
* **checkout:** add missing onChange to billing city input ([4cd6db2](https://github.com/Jaal-Yantra-Textiles/v2/commit/4cd6db2c65af84ff425766be3255f6aa14acb062))
* **checkout:** add missing onChange to billing city input ([b0b3bcf](https://github.com/Jaal-Yantra-Textiles/v2/commit/b0b3bcfceb09c807f1353cc6945ede02849cc4a7))
* **partner-ui:** add null-safe variant id check and include inventory_items in variants API ([caf4a3b](https://github.com/Jaal-Yantra-Textiles/v2/commit/caf4a3b98afa17f6d2521b6fa3911f792a5f728f))
* additional link fixes ([3ed83e2](https://github.com/Jaal-Yantra-Textiles/v2/commit/3ed83e294b47b28c26d50b9dc979008fed688bd9))
* address updates ([1a90e77](https://github.com/Jaal-Yantra-Textiles/v2/commit/1a90e77ad2474a581a5ef25a8533e9207bdaf448))
* adjust design to match the other sections ([7f742c4](https://github.com/Jaal-Yantra-Textiles/v2/commit/7f742c4853a20fc62bebd92a7890b2f1a682016f))
* adjust login-template padding ([de719dd](https://github.com/Jaal-Yantra-Textiles/v2/commit/de719dd3e6f31bf21075171097cad10e72097d6f))
* adjust the padding on the mobile account page ([7008584](https://github.com/Jaal-Yantra-Textiles/v2/commit/70085849c9c76b2108880811d383604bb0960bf9))
* **admin:** allow limit/offset/q/status on /admin/partners list ([87053d7](https://github.com/Jaal-Yantra-Textiles/v2/commit/87053d75ec27234f16bca53ca49f3d9bfcf6250c))
* axiosAdapter key typo ([be00546](https://github.com/Jaal-Yantra-Textiles/v2/commit/be00546cfbf4daf59ee4d51e2e7edc0c4121b69f))
* **websites:** backfill default pages and surface domain aliases in admin ([3da44a1](https://github.com/Jaal-Yantra-Textiles/v2/commit/3da44a1d4f1cb0a54d8fa91b030671a4594cf83f))
* base url +  env template ([764cf5a](https://github.com/Jaal-Yantra-Textiles/v2/commit/764cf5a9d7e6df7dfcd00548f3d1652b320d5a40))
* **whatsapp:** base64-encode inbound media before workflow upload ([a962b4c](https://github.com/Jaal-Yantra-Textiles/v2/commit/a962b4cea2c8899b58606fa47287452626bcf658))
* better typing of app ([#69](https://github.com/Jaal-Yantra-Textiles/v2/issues/69)) ([018acb9](https://github.com/Jaal-Yantra-Textiles/v2/commit/018acb925465c68f88d70104803af30cb63c131f))
* bring back regions dependency ([17ccb3e](https://github.com/Jaal-Yantra-Textiles/v2/commit/17ccb3e79bebd1be6b7de6502bcc44fe00f1c067))
* build ([e86c676](https://github.com/Jaal-Yantra-Textiles/v2/commit/e86c6760237d3950f961cee25e009db5c94dd2e1))
* build ([683dc8e](https://github.com/Jaal-Yantra-Textiles/v2/commit/683dc8e83aed5e1ec907533df3befea81fd36694))
* build ([1d9701a](https://github.com/Jaal-Yantra-Textiles/v2/commit/1d9701a90d5d0201d7d47b60ebefea86dd0cab48))
* build ([74a019e](https://github.com/Jaal-Yantra-Textiles/v2/commit/74a019e456be478fdd1a7a2be63d8f37c850b52f))
* build ts errors ([cdf7242](https://github.com/Jaal-Yantra-Textiles/v2/commit/cdf7242be5dc2f4ad3e4d444ea4448e7000f12a2))
* button spacing ([c2d9fe0](https://github.com/Jaal-Yantra-Textiles/v2/commit/c2d9fe0938b673e51cad512f1ffe3855b49934d3))
* cache optimizations ([bec2951](https://github.com/Jaal-Yantra-Textiles/v2/commit/bec29514a5f9fede544bb5312df2ba8ace1f71ea))
* calculate price issue ([7af23f1](https://github.com/Jaal-Yantra-Textiles/v2/commit/7af23f144127216c7edd221fa1fdf0ed8b40098c))
* cart crash on backorders ([#105](https://github.com/Jaal-Yantra-Textiles/v2/issues/105)) ([8671332](https://github.com/Jaal-Yantra-Textiles/v2/commit/86713324c7af654adcb5b08d4942cd365d0bf06c))
* cart dropdown ([2aa6e8b](https://github.com/Jaal-Yantra-Textiles/v2/commit/2aa6e8bc423eb3e0c120f385659390e44eabddb2))
* cart totals issues and promos not stacking ([#511](https://github.com/Jaal-Yantra-Textiles/v2/issues/511)) ([fb0ef6b](https://github.com/Jaal-Yantra-Textiles/v2/commit/fb0ef6b4cc1ac2c5facd872ac36ee5457a94e532))
* cart totals issues and promos not stacking ([#511](https://github.com/Jaal-Yantra-Textiles/v2/issues/511)) ([eac359c](https://github.com/Jaal-Yantra-Textiles/v2/commit/eac359cc8d52f1d33d8712e18e4e0f38940afb3e))
* Cart translation sync ([67e50aa](https://github.com/Jaal-Yantra-Textiles/v2/commit/67e50aaeffa0ceef5e6c23ab65318d47fbb02bd6))
* center the search page position ([8caae34](https://github.com/Jaal-Yantra-Textiles/v2/commit/8caae34867026cda0ad2d48c428c82c9d7dfd90c))
* **mobile:** centre Plus button, remove Tools toggle, auto-pan on empty canvas ([cea0b8d](https://github.com/Jaal-Yantra-Textiles/v2/commit/cea0b8dc050941d09f540c8e71955a55fbd4766d))
* change flag ([1c5f744](https://github.com/Jaal-Yantra-Textiles/v2/commit/1c5f744e991389504e52ae39cfe84b74902353d7))
* change origin_country to material in product info ([#93](https://github.com/Jaal-Yantra-Textiles/v2/issues/93)) ([7a5e0c8](https://github.com/Jaal-Yantra-Textiles/v2/commit/7a5e0c81c2d4346ae01519157b380b72f5227c05))
* changed dev port to 8000, so it is inline with other starters ([#8](https://github.com/Jaal-Yantra-Textiles/v2/issues/8)) ([a410ac2](https://github.com/Jaal-Yantra-Textiles/v2/commit/a410ac262dc3789b71ad411b0276f27c237b76f5))
* Changes to make order details load ([fbd03db](https://github.com/Jaal-Yantra-Textiles/v2/commit/fbd03db9212e9979ffa9e2c09aebbfae4ef7c21e))
* check stocked quantity if variant has managed inventory ([5b287c6](https://github.com/Jaal-Yantra-Textiles/v2/commit/5b287c6132e910d2e1762df931c4ef6c38c005be))
* checkout shipping address behaviour ([5eb42f2](https://github.com/Jaal-Yantra-Textiles/v2/commit/5eb42f2b4f09292f8a58b1935fa6684da94c769b))
* checkout state ([a9bff08](https://github.com/Jaal-Yantra-Textiles/v2/commit/a9bff08229d2a48d525fe9ce666b8b71802a2872))
* checkout state ([3c47b11](https://github.com/Jaal-Yantra-Textiles/v2/commit/3c47b112cd2750ff306bcf7d406e4b218b2b6e4b))
* checkout state fix ([b41fce9](https://github.com/Jaal-Yantra-Textiles/v2/commit/b41fce954c69d8daf6b4f2b545ebcc98cff85cca))
* **zod:** clean up remaining v4 build errors (z.record, error.errors, addIssue, default) ([11fb33b](https://github.com/Jaal-Yantra-Textiles/v2/commit/11fb33b6858185254ddbc8074998875e4494f55f))
* cleanup ([169e7f8](https://github.com/Jaal-Yantra-Textiles/v2/commit/169e7f84dc2efab1e6270dda5afc013c7074d2ed))
* cleanup ([26c57df](https://github.com/Jaal-Yantra-Textiles/v2/commit/26c57df01c776c21f2c49d7e4cbd2e5c9616235a))
* cleanup ([4bb007b](https://github.com/Jaal-Yantra-Textiles/v2/commit/4bb007b5da28bda023e1d75f9a72294831fe72ba))
* cleanup ([7db9eab](https://github.com/Jaal-Yantra-Textiles/v2/commit/7db9eab86ff6e0375beca1adb549dc5725964206))
* cleanup ([ce42a82](https://github.com/Jaal-Yantra-Textiles/v2/commit/ce42a82aa8bfd53f5d96cd3efe6497248b3a6d68))
* cleanup ([31b2f6e](https://github.com/Jaal-Yantra-Textiles/v2/commit/31b2f6e9f924475c9f1abd4ccb5517ed15731066))
* cleanup ([737fdc0](https://github.com/Jaal-Yantra-Textiles/v2/commit/737fdc0b74e197a339e22ef743998ca2ab529541))
* Cleanup and correct payment processor handling ([0f5244f](https://github.com/Jaal-Yantra-Textiles/v2/commit/0f5244f0f9b8f846e6b2ecf9f761bd81d1f348f5))
* cleanup imports ([4725fde](https://github.com/Jaal-Yantra-Textiles/v2/commit/4725fde24f30c3b8212744d34d36aee7b101b01f))
* Cleanup unused functions and only use convert to locale for money formatting ([cf8faff](https://github.com/Jaal-Yantra-Textiles/v2/commit/cf8faffad0f5b16bcd13a09b4933c62aabed7e3c))
* cleanup, note ([f385cf4](https://github.com/Jaal-Yantra-Textiles/v2/commit/f385cf4a2ad869299d426da2fe9cd54760ad1dd4))
* cleanups ([06b3a0e](https://github.com/Jaal-Yantra-Textiles/v2/commit/06b3a0e7c8b621b11edd95a41afe6c1e36a20398))
* collection infinite scroll ([4616ed4](https://github.com/Jaal-Yantra-Textiles/v2/commit/4616ed48a0f972a4f2490a27c69fc63aa5de61b4))
* comment typos ([f0d245f](https://github.com/Jaal-Yantra-Textiles/v2/commit/f0d245fe669b5e7aaa8960d7eac6df869cffda36))
* conditional rendering ([67e8ae7](https://github.com/Jaal-Yantra-Textiles/v2/commit/67e8ae74a19bbd0c7716a6b5c580e0618c524ea8))
* **partner-ui:** consume WhatsApp deep-link wa_token to auto-auth ([5b5a788](https://github.com/Jaal-Yantra-Textiles/v2/commit/5b5a788c3a4c4f16b102638c913c3dcdaabdb889))
* content-container padding ([a25d80b](https://github.com/Jaal-Yantra-Textiles/v2/commit/a25d80b4e55bd13cba90b139a5cf224470614eaa))
* controlled state in checkout form ([f0d3741](https://github.com/Jaal-Yantra-Textiles/v2/commit/f0d37410f21e8e61c4a03e8e096bc3732660093e))
* copy ([f13af0b](https://github.com/Jaal-Yantra-Textiles/v2/commit/f13af0b339df0a4c22833a375006b32bec759c46))
* correct line item calculations when admentments exist ([471fcff](https://github.com/Jaal-Yantra-Textiles/v2/commit/471fcff5ff155cd460c2cd332c555d9af9f3c4c4))
* country list order ([fb851ed](https://github.com/Jaal-Yantra-Textiles/v2/commit/fb851ed581312a8bce36b42c470a0ee6a25e90d6))
* country loader controlled ([#99](https://github.com/Jaal-Yantra-Textiles/v2/issues/99)) ([b205f49](https://github.com/Jaal-Yantra-Textiles/v2/commit/b205f49670c1771960227f57df4f2eccf55cbd24))
* create client fails due to empty body ([#24](https://github.com/Jaal-Yantra-Textiles/v2/issues/24)) ([ddc907c](https://github.com/Jaal-Yantra-Textiles/v2/commit/ddc907c060807f1e0879ae0019c68e3fcaeea109))
* customer registration unauthorized error ([f0e1f28](https://github.com/Jaal-Yantra-Textiles/v2/commit/f0e1f28163845e2b64e55979a36649e46055c360))
* debug ([a2c9262](https://github.com/Jaal-Yantra-Textiles/v2/commit/a2c926269b924450ba473bfc5c094caf76ca008f))
* default region fallback us ([4be92db](https://github.com/Jaal-Yantra-Textiles/v2/commit/4be92db9280d27857d3680cbb31afc873289f110))
* discount code ([59a2508](https://github.com/Jaal-Yantra-Textiles/v2/commit/59a2508ec684eadff4ca44b25d895426a990e32f))
* Dont throw if customer not available ([5b38dd6](https://github.com/Jaal-Yantra-Textiles/v2/commit/5b38dd6213c5c0dae1a9ba932c6b678920d2b463))
* **storefront:** drop node-linker=hoisted so pnpm symlinks react instead of duplicating it ([caea4ec](https://github.com/Jaal-Yantra-Textiles/v2/commit/caea4ecad2a1e11d30a523a425570de9e935ed2d))
* e2e build ([27685a9](https://github.com/Jaal-Yantra-Textiles/v2/commit/27685a988d21b3911bf548bbdff8a519c3797ce1))
* e2e cli version ([ee4c684](https://github.com/Jaal-Yantra-Textiles/v2/commit/ee4c6845824a942f7902a99f9021db9dedff2d8d))
* e2e node version ([3f5dc23](https://github.com/Jaal-Yantra-Textiles/v2/commit/3f5dc23f75e52270bdf450a832ff4b5edef5aa2b))
* empty array handling ([dfdacb4](https://github.com/Jaal-Yantra-Textiles/v2/commit/dfdacb4033156db682b9495edc895ebcf90fac32))
* empty search page ([d03d3f7](https://github.com/Jaal-Yantra-Textiles/v2/commit/d03d3f726d3bb509e374c7a4637ceba5c9a74ae8))
* enforce light mode ([abd5b2b](https://github.com/Jaal-Yantra-Textiles/v2/commit/abd5b2ba5dcfc78d004f03343d62607c9f11d396))
* **visual_flows:** enforce strict filter resolution in read-data to prevent silent misqueries ([1665fb7](https://github.com/Jaal-Yantra-Textiles/v2/commit/1665fb7ab39de6b09582096aec4c5fc1209be672))
* escape apos ([04aa4c3](https://github.com/Jaal-Yantra-Textiles/v2/commit/04aa4c3a439c0085f200a2eac29f7b213511522f))
* exclude crawlers from middleware ([8afa1a2](https://github.com/Jaal-Yantra-Textiles/v2/commit/8afa1a2aa70f6e1f8328876f153f170c6ceef92b))
* **visual-flows:** execute_code validator strips strings before comments ([7dfbad7](https://github.com/Jaal-Yantra-Textiles/v2/commit/7dfbad72870642550a8537f91420fc2144e06707))
* fallback when stripe key is empty ([6ca64fa](https://github.com/Jaal-Yantra-Textiles/v2/commit/6ca64fa1d9977e53d86dda3c7810b752fa7efc53))
* **design-editor:** fix image load race condition, add material/partner canvas badges, improve mobile layout ([cd6ff99](https://github.com/Jaal-Yantra-Textiles/v2/commit/cd6ff99df097f2a9c6c87a6c964ea1317dcb1e3c))
* fix incorrect variable name in .env.template ([3c01a67](https://github.com/Jaal-Yantra-Textiles/v2/commit/3c01a67503ed22721b3c41f993cf845ca25fc7e6))
* Fix the checkout flow and orders page ([89cd1d1](https://github.com/Jaal-Yantra-Textiles/v2/commit/89cd1d13eb92017156eb10b8ad42d8da428cdcd1))
* **partner-ui:** fix variant media filtering and route modal context usage ([2df2b57](https://github.com/Jaal-Yantra-Textiles/v2/commit/2df2b577234da4b3b146f0be979982c5251a9a89))
* fixes for projects where translation isn't enabled ([#555](https://github.com/Jaal-Yantra-Textiles/v2/issues/555)) ([405cd03](https://github.com/Jaal-Yantra-Textiles/v2/commit/405cd03f9586d8b1ce87ac096bdaafc3e350d35c))
* footer mobile spacing ([d75c2b5](https://github.com/Jaal-Yantra-Textiles/v2/commit/d75c2b510a6904a37b3bd93ef6cec34fc5e0196a))
* **jest:** force CJS output on swc transforms (tokenx still ESM after [#166](https://github.com/Jaal-Yantra-Textiles/v2/issues/166)) ([37e7639](https://github.com/Jaal-Yantra-Textiles/v2/commit/37e763935a8e450d4c658b7aaab0b77ea559e743))
* force light mode ([5c8ccea](https://github.com/Jaal-Yantra-Textiles/v2/commit/5c8ccea08661266ff74eb156e7324f255b482d2e))
* formatting + fix `legacyBehaviour` ([2607271](https://github.com/Jaal-Yantra-Textiles/v2/commit/2607271fd64ccb9ccf54781cdc8e4a0a7f3f5775))
* getVariantPrices now returns the correct prices ([#10](https://github.com/Jaal-Yantra-Textiles/v2/issues/10)) ([190b18d](https://github.com/Jaal-Yantra-Textiles/v2/commit/190b18db021c2a68b443e3bfebbfc28871aa818a))
* handle > 6 items in footer nav ([ec86789](https://github.com/Jaal-Yantra-Textiles/v2/commit/ec86789636777bc86dd8ce225f632a3e9a93f4bf))
* handle 404 ([faacafb](https://github.com/Jaal-Yantra-Textiles/v2/commit/faacafb71dd89b294cc9971c27d7931c10be551d))
* handle checkout loading indicators ([cfad17c](https://github.com/Jaal-Yantra-Textiles/v2/commit/cfad17c494f9794734927a2b0b66f5998a6d7edc))
* **checkout:** handle error on invalid promo code ([0027ca4](https://github.com/Jaal-Yantra-Textiles/v2/commit/0027ca408d685287b9f7b37455fb34a1213f07e6))
* **checkout:** handle error on invalid promo code ([3604c0f](https://github.com/Jaal-Yantra-Textiles/v2/commit/3604c0fea68b1331e7302a1a8a3ace055e639077))
* **jest:** handle ESM-only tokenx transitive (@mastra/core dep) ([a9626c7](https://github.com/Jaal-Yantra-Textiles/v2/commit/a9626c79eca843d90dc8d4888ed297ae9de3b19d))
* **visual_flows:** handle WhatsApp template variables as string or array ([7500fd9](https://github.com/Jaal-Yantra-Textiles/v2/commit/7500fd9dc1538e5f0ea037fbbf3d98055e407fcb))
* handle when no region with country configured ([#520](https://github.com/Jaal-Yantra-Textiles/v2/issues/520)) ([886487d](https://github.com/Jaal-Yantra-Textiles/v2/commit/886487df4ca31d84b4c2f5e41f50a37628f9d438))
* handle when no region with country configured ([#520](https://github.com/Jaal-Yantra-Textiles/v2/issues/520)) ([1277359](https://github.com/Jaal-Yantra-Textiles/v2/commit/12773596afd821c13da8c6f57ecc31d3035878e3))
* homepage performance ([ec912fc](https://github.com/Jaal-Yantra-Textiles/v2/commit/ec912fc666d660e424f930c12f2e94254cb6fc4c))
* image gallery ([c4c9b19](https://github.com/Jaal-Yantra-Textiles/v2/commit/c4c9b1980aff49ac7908b22c0c3ffc1f692afda4))
* images + prices ([6550b7d](https://github.com/Jaal-Yantra-Textiles/v2/commit/6550b7de04a36a716e25daeb2a473325bb3c846c))
* Incldue customer auth. in create cart request ([cf9aab2](https://github.com/Jaal-Yantra-Textiles/v2/commit/cf9aab2315fcc5f83f9758f782bc852cddcfa3d4))
* indendations ([10473b7](https://github.com/Jaal-Yantra-Textiles/v2/commit/10473b73ec1884c8638b33ea6a7d3c23514c8b13))
* infinite loop in collection pages ([ece5fe5](https://github.com/Jaal-Yantra-Textiles/v2/commit/ece5fe5010e8e87a80ecc16fd6e4ca9b7bc3f2d4))
* initPayment ([2d5e187](https://github.com/Jaal-Yantra-Textiles/v2/commit/2d5e187fdf1ff45e5ad4e9414f463d466add7b69))
* inventory quantity check change ([c7c1167](https://github.com/Jaal-Yantra-Textiles/v2/commit/c7c1167524af634dab3453b53a4cca0f38655a4a))
* Issues with Product types ([292d0f0](https://github.com/Jaal-Yantra-Textiles/v2/commit/292d0f09d19a4c7dad21ae02f6288cbf9605c027))
* layouts ([dbed9b9](https://github.com/Jaal-Yantra-Textiles/v2/commit/dbed9b935cde159e5b20740f90268a518bcd0cf4))
* legacyBehavior on `Link` ([2b1863c](https://github.com/Jaal-Yantra-Textiles/v2/commit/2b1863c7b27d8e2f2947df8f721ae994424bc50b))
* lint ([#417](https://github.com/Jaal-Yantra-Textiles/v2/issues/417)) ([8127216](https://github.com/Jaal-Yantra-Textiles/v2/commit/8127216ac2acb29dbf684727ff0a3158e840a87b))
* logout ([8179f75](https://github.com/Jaal-Yantra-Textiles/v2/commit/8179f757a31ca9936e869de9f3b651fc1baf9515))
* logs cleanup ([8175704](https://github.com/Jaal-Yantra-Textiles/v2/commit/81757042991fd272fe7d7b389e61fffc70224b24))
* **mobile:** make Plus icon larger and bolder to fill the circle button ([b043e01](https://github.com/Jaal-Yantra-Textiles/v2/commit/b043e01fd03d95b29e44a6af8c68dc81b47ebba8))
* medusaRequest types ([456b439](https://github.com/Jaal-Yantra-Textiles/v2/commit/456b439f12eb55af37e9c1a39a1061a455565ce6))
* medusav2 feature flag ([d05831b](https://github.com/Jaal-Yantra-Textiles/v2/commit/d05831b60ca729a7e1b31ddca59ccc93e7571780))
* meta desc ([dd047a5](https://github.com/Jaal-Yantra-Textiles/v2/commit/dd047a575196017116c62cc531a52212b538da34))
* middlewacre logic ([e860ddd](https://github.com/Jaal-Yantra-Textiles/v2/commit/e860ddd9965551b8596a039e59f13af971520ce2))
* middleware ([2f8b0ff](https://github.com/Jaal-Yantra-Textiles/v2/commit/2f8b0ff5babfa4fc42a3425eb96200cd3f68e27d))
* middleware comment ([d1a2ad9](https://github.com/Jaal-Yantra-Textiles/v2/commit/d1a2ad9f3b8699eabcd5590f4543917bb9d2152e))
* **zod:** migrate v3 schemas to v4 to unblock Medusa 2.14.0 boot ([ea900be](https://github.com/Jaal-Yantra-Textiles/v2/commit/ea900be51e3ae7f484354fd2038817958cc42146))
* Minor changes to payments ([a46b7d4](https://github.com/Jaal-Yantra-Textiles/v2/commit/a46b7d44ad711e958f095581fd141344bf98dfd7))
* Minor fixes to product listing and checkout ([ced88e4](https://github.com/Jaal-Yantra-Textiles/v2/commit/ced88e42af345569872d211c221249d0d3153fa1))
* Minor fixes to store ([f6acc35](https://github.com/Jaal-Yantra-Textiles/v2/commit/f6acc350bd0d802e9ed713c9fe75590c2d68c64e))
* Minor product type issues ([3751988](https://github.com/Jaal-Yantra-Textiles/v2/commit/37519881a882bbe7ea741b2e78b2abe3db963a24))
* mobile action z index ([#518](https://github.com/Jaal-Yantra-Textiles/v2/issues/518)) ([d73d523](https://github.com/Jaal-Yantra-Textiles/v2/commit/d73d52326e125456999026a700171ea7a9671c16))
* mobile action z index ([#518](https://github.com/Jaal-Yantra-Textiles/v2/issues/518)) ([d767dff](https://github.com/Jaal-Yantra-Textiles/v2/commit/d767dff77d6901440b81031d554a6521b3cecaf4))
* Mobile product options select showing when there's no options ([e7b1f77](https://github.com/Jaal-Yantra-Textiles/v2/commit/e7b1f77db7c89122ed6b1a99eb4ea09185ab1017))
* **partner-ui:** mount notification bell in main layout ([10519f2](https://github.com/Jaal-Yantra-Textiles/v2/commit/10519f24fcd49464533239047bc6c0ae888372c0)), closes [#188](https://github.com/Jaal-Yantra-Textiles/v2/issues/188)
* move link into popover button ([acc8ee9](https://github.com/Jaal-Yantra-Textiles/v2/commit/acc8ee9eb2c4a4ab48a83b94f2c25d56a83c6a8d))
* **partner-ui:** move notification bell from sidebar to topbar ([dc778b4](https://github.com/Jaal-Yantra-Textiles/v2/commit/dc778b48cbb2a0ac3f8bcba78330b83b50381914)), closes [#189](https://github.com/Jaal-Yantra-Textiles/v2/issues/189)
* nextcookies ([b3495f6](https://github.com/Jaal-Yantra-Textiles/v2/commit/b3495f602a0ff4159598d8bc605ee62ffafea3ae))
* no 404 if empty array in collection route ([17ce168](https://github.com/Jaal-Yantra-Textiles/v2/commit/17ce1684900250f3a602c034a92176cf609efd03))
* **partner-decline:** NOT_FOUND on cross-partner; dispatch bRun in spec ([e880b70](https://github.com/Jaal-Yantra-Textiles/v2/commit/e880b70f5bbb93b3f4976c5c370fb453f15ba2f1))
* not-found classname ([8bf380b](https://github.com/Jaal-Yantra-Textiles/v2/commit/8bf380b423245b3a35a4c17a2487b398c61db14a))
* notes ([a25851f](https://github.com/Jaal-Yantra-Textiles/v2/commit/a25851f99df1ce355def1a3c02f43fb90eddeb0b))
* objectID key ([939a9aa](https://github.com/Jaal-Yantra-Textiles/v2/commit/939a9aa94dc0b4127862ceef45aa899bed9665c0))
* onboarding cta productpage position ([b61593d](https://github.com/Jaal-Yantra-Textiles/v2/commit/b61593d956faf4b2efce4e8c89dfda14a2fad318))
* onboarding middleware ([fe74c6e](https://github.com/Jaal-Yantra-Textiles/v2/commit/fe74c6e9916efe09932c66e56af6244996befb51))
* onboarding order url ([3a42b50](https://github.com/Jaal-Yantra-Textiles/v2/commit/3a42b50e80eba80cab0297c259cb78e74342f27a))
* Only pass region ID when fetching produc ([32f76c3](https://github.com/Jaal-Yantra-Textiles/v2/commit/32f76c35a5252dc9613d4a8ad2d3da85d24782f8))
* optimize checkout layout ([e34b614](https://github.com/Jaal-Yantra-Textiles/v2/commit/e34b614168ebff76ff03a8fc65a2f7d37b18d009))
* optimize images ([410f47f](https://github.com/Jaal-Yantra-Textiles/v2/commit/410f47fa7d6477ec376a9a9784af870d4dab1919))
* optimize middleware ([7fad0fd](https://github.com/Jaal-Yantra-Textiles/v2/commit/7fad0fdfca74ffca7e61289723dc1564782c2122))
* optimize product page static generation ([c7b19de](https://github.com/Jaal-Yantra-Textiles/v2/commit/c7b19dea2e191b24b56427ec1ef733126593b711))
* order confirmation product title ([86fbabc](https://github.com/Jaal-Yantra-Textiles/v2/commit/86fbabcc4d7274234c158171b0ff58ae24ff02c7))
* Out of stock condition ([2c32807](https://github.com/Jaal-Yantra-Textiles/v2/commit/2c32807d47d3d6cff51739a6a422af485405b84d))
* **whatsapp:** outbox pattern + audit row on send failures ([4721937](https://github.com/Jaal-Yantra-Textiles/v2/commit/4721937f63df31b1146896d17997e7a8f586e78e))
* padding, spacing, minor bugs ([f71091b](https://github.com/Jaal-Yantra-Textiles/v2/commit/f71091b7f32eae7ffe6b371765e4b4488d0e481b))
* pass cart id to collection ([6433303](https://github.com/Jaal-Yantra-Textiles/v2/commit/643330311699b7325811e5e75e00450575288635))
* pay full amount with gift cart ([abc2adb](https://github.com/Jaal-Yantra-Textiles/v2/commit/abc2adba69da7bd5602019a7622f848bd37f44b5))
* payment provider ID detection ([179a245](https://github.com/Jaal-Yantra-Textiles/v2/commit/179a245cab4a5efa730381226c647149aea4910a))
* **whatsapp:** pickUrl trims object-branch URLs ([8b7eb87](https://github.com/Jaal-Yantra-Textiles/v2/commit/8b7eb872ca8efbcb93285df485c1c5fa5cafb013))
* **whatsapp:** pin resolved language on new conversation ([d0ee5e8](https://github.com/Jaal-Yantra-Textiles/v2/commit/d0ee5e88fa71a24711446434f70ac52bebe82134))
* prevent double redirect on regionless home ([e857c26](https://github.com/Jaal-Yantra-Textiles/v2/commit/e857c26446e063438cf955281144dbeeffc71dc3))
* price breakdown nudge + moodboard image layers ([040929c](https://github.com/Jaal-Yantra-Textiles/v2/commit/040929c1f49a37c31cb87e185f53c47e91b77f14))
* product page static generation ([bae53b2](https://github.com/Jaal-Yantra-Textiles/v2/commit/bae53b223a83d5f057c606a50ac11d72b1d5a17f))
* product pagination ([1844902](https://github.com/Jaal-Yantra-Textiles/v2/commit/18449025672bd0ff6be84f10495409e54f8d77fc))
* Product types ([fc83e9f](https://github.com/Jaal-Yantra-Textiles/v2/commit/fc83e9fda9242d7f5b96ec99f61a7c21fc4bcab6))
* proper handling of 404 in routes ([e4f6097](https://github.com/Jaal-Yantra-Textiles/v2/commit/e4f609720475732a1d1ce79327c620c7956d7730))
* province required ([99580e6](https://github.com/Jaal-Yantra-Textiles/v2/commit/99580e68706191b11adddfd09e280a62769ab420))
* react version overrides ([3f4b3c0](https://github.com/Jaal-Yantra-Textiles/v2/commit/3f4b3c04b793e45a47d15546b9ff090b34a4c1ba))
* readme spelling ([d7a31a5](https://github.com/Jaal-Yantra-Textiles/v2/commit/d7a31a5380c1603c3b0e279a6cbcdbe687cba67f))
* redirect only when nextUrl exists. resolve [#282](https://github.com/Jaal-Yantra-Textiles/v2/issues/282) ([7126834](https://github.com/Jaal-Yantra-Textiles/v2/commit/7126834dd6793adee699ed694ba3d403cf621a72))
* **jest:** redirect tokenx to a CJS shim (transform-pass-through wasn't enough) ([ba8911c](https://github.com/Jaal-Yantra-Textiles/v2/commit/ba8911c2ab9cb991af3119f3b5e22cb075d8c9e3))
* redirects ([f17a916](https://github.com/Jaal-Yantra-Textiles/v2/commit/f17a91670c41227cd14d3aa8980b6ddb98240085))
* refurnish blob image layers on save + use PUT for existing designs ([c4c7620](https://github.com/Jaal-Yantra-Textiles/v2/commit/c4c7620a5187ddf41b5baa8aad6e1716f102a2ad))
* remove `<a>` from `<Link>`, add prettier dev dep ([292fe9c](https://github.com/Jaal-Yantra-Textiles/v2/commit/292fe9c6535472513732c0f0403be35816bfe540))
* remove card details from order page ([#89](https://github.com/Jaal-Yantra-Textiles/v2/issues/89)) ([979f4e3](https://github.com/Jaal-Yantra-Textiles/v2/commit/979f4e31f375d2e45365b53c551b7aa256382d23))
* **cypress:** remove cypress.json ([e540541](https://github.com/Jaal-Yantra-Textiles/v2/commit/e5405413a58007b3342dbdf2d07da90818c947a3))
* **storefront:** Remove hardcoded USD from design checkout modal ([16234cd](https://github.com/Jaal-Yantra-Textiles/v2/commit/16234cd7c2529ab00c38431cf7b96b43d58cdefa))
* Remove invalid region arg ([5b0c7b0](https://github.com/Jaal-Yantra-Textiles/v2/commit/5b0c7b076066e41d9e5173d187deb20362a7722b))
* Remove region from price calc method ([e2f1207](https://github.com/Jaal-Yantra-Textiles/v2/commit/e2f12071209eb0ba4bf86490056a85e7365c5df0))
* remove store button outline in main nav ([9b23346](https://github.com/Jaal-Yantra-Textiles/v2/commit/9b23346bec21db23549395c21010688dd17826ef))
* remove unused fields when listing shipping options ([#516](https://github.com/Jaal-Yantra-Textiles/v2/issues/516)) ([22d1ed8](https://github.com/Jaal-Yantra-Textiles/v2/commit/22d1ed8fb069c0fee04db0ce4c19c707c1f8c1c7))
* remove unused fields when listing shipping options ([#516](https://github.com/Jaal-Yantra-Textiles/v2/issues/516)) ([18cf288](https://github.com/Jaal-Yantra-Textiles/v2/commit/18cf288d6ae8c11fb98aeca343dc23d946583fbc))
* replace decimal separator in order confirmation ([#425](https://github.com/Jaal-Yantra-Textiles/v2/issues/425)) ([cef8d64](https://github.com/Jaal-Yantra-Textiles/v2/commit/cef8d64f5203a7dca494384b991948ff03a9cb23))
* replace decimal separator in order confirmation ([#425](https://github.com/Jaal-Yantra-Textiles/v2/issues/425)) ([c647213](https://github.com/Jaal-Yantra-Textiles/v2/commit/c647213f52591cbef44e5705b9ce78840ced9a28))
* **mobile:** replace Plus component with raw SVG on centre button ([d2371ee](https://github.com/Jaal-Yantra-Textiles/v2/commit/d2371eea6b49fe105f307398825931e6d4f1eee5))
* reset auth headers if no token ([5edc382](https://github.com/Jaal-Yantra-Textiles/v2/commit/5edc3820662c436dba09d11e6e468f259993a69c))
* reset cart on logout ([3744c57](https://github.com/Jaal-Yantra-Textiles/v2/commit/3744c5722fb5c177fbb1bda00c02edff03b50d25))
* reset meilisearch as the default provider ([bfb5026](https://github.com/Jaal-Yantra-Textiles/v2/commit/bfb50260d6d4cc6426700de67c5698bc00c56475))
* reset search to default ([f246356](https://github.com/Jaal-Yantra-Textiles/v2/commit/f2463563160a30acbf925dd6b3e345bae67c53ab))
* retrieve price type ([3b5eeaa](https://github.com/Jaal-Yantra-Textiles/v2/commit/3b5eeaaa3f995cabe7bfe0995253959c42dbf5b5))
* retrieve price type ([a50bab6](https://github.com/Jaal-Yantra-Textiles/v2/commit/a50bab6da6f5e81f91144d6d02b9c6159841c60f))
* rm /pages ([0dbcd13](https://github.com/Jaal-Yantra-Textiles/v2/commit/0dbcd138282f011df1a57bc9329da2ba0b0e912f))
* rm axios fetch adapter ([b953290](https://github.com/Jaal-Yantra-Textiles/v2/commit/b953290b1ac8608c6c0476d1e753f6bc7f953a1a))
* rm logs ([3ebc057](https://github.com/Jaal-Yantra-Textiles/v2/commit/3ebc05730ff7d68e0b453461662c6d85f30d6785))
* rm obsolete "force-dynamic" ([7f49809](https://github.com/Jaal-Yantra-Textiles/v2/commit/7f4980932711f2612e12ab2a997e053d38b2049d))
* rm POSTGRES_URL ([2e2ef11](https://github.com/Jaal-Yantra-Textiles/v2/commit/2e2ef110a8b99be5c65620a4abecf9dccefedc56))
* rm redirects after signup ([968747e](https://github.com/Jaal-Yantra-Textiles/v2/commit/968747e9944b2e69a0a180f90795a899ab889683))
* rm redundant "use server" ([1cf4f4e](https://github.com/Jaal-Yantra-Textiles/v2/commit/1cf4f4e67d4cdf0c3bedb0d98cf4809a1177e1e6))
* rm unused import ([22a54f4](https://github.com/Jaal-Yantra-Textiles/v2/commit/22a54f431fffaf1a1d070d4f78ac9a93215ac632))
* sale price color ([df5524f](https://github.com/Jaal-Yantra-Textiles/v2/commit/df5524fc91583146b4de2ba9a5fd9608c29b2ade))
* sameAsBilling checkbox ([07f3d82](https://github.com/Jaal-Yantra-Textiles/v2/commit/07f3d8285b9b98c0db2a29d773ee6bd96c7e95aa))
* satisfy the almighty typescript ([13baa49](https://github.com/Jaal-Yantra-Textiles/v2/commit/13baa494b300393d366bca60d3c6ee76a728ebd9))
* searchmodal in safari ([3fbe751](https://github.com/Jaal-Yantra-Textiles/v2/commit/3fbe7516f5aad7b557cca73dd2c506f70d6dc3e5))
* shipping address labels ([d25b29f](https://github.com/Jaal-Yantra-Textiles/v2/commit/d25b29fa0b595bb53f8f9cea6fc59d80c65efefc))
* shipping method ([e0969bb](https://github.com/Jaal-Yantra-Textiles/v2/commit/e0969bb2e6aabf7f3afd06622a985290fa4a9155))
* shipping method selection ([1433801](https://github.com/Jaal-Yantra-Textiles/v2/commit/14338016d7474ae2a320868a3765506cc3fdf6ee))
* show order's payment and fulfillment status ([cb2d68a](https://github.com/Jaal-Yantra-Textiles/v2/commit/cb2d68a794e864172f9778296ebb9af153fe2f7a))
* show proper thumbnails on order overview ([5f48d44](https://github.com/Jaal-Yantra-Textiles/v2/commit/5f48d448c0cd41d563055e186f75425669dc44b2))
* Sign up ([80e94e5](https://github.com/Jaal-Yantra-Textiles/v2/commit/80e94e56f68882de75b890fc3c9a5ca53015a16b))
* signOut redirect bug ([23766a5](https://github.com/Jaal-Yantra-Textiles/v2/commit/23766a548f95902fbc9c5f639d0332b074b10f32))
* sort ([3acd563](https://github.com/Jaal-Yantra-Textiles/v2/commit/3acd56366b6c3da0d1ed72eae78433f0bde40527))
* sort 100 products ([09118b8](https://github.com/Jaal-Yantra-Textiles/v2/commit/09118b855ff42271003d119dc988034e49f9fad6))
* sort options margin ([9bdfeb8](https://github.com/Jaal-Yantra-Textiles/v2/commit/9bdfeb862a279232c1d2b61d23b1edc44396e065))
* sort radio group typing ([87ef903](https://github.com/Jaal-Yantra-Textiles/v2/commit/87ef903c9a2a0f2be9ca24c5bc0cf0d43a541e2e))
* sorting function ([7603fc4](https://github.com/Jaal-Yantra-Textiles/v2/commit/7603fc42c82c570a977bc559727b0972ce30b239))
* **whatsapp:** strip :reminder:DATE suffix from pending_run_id ([414e88a](https://github.com/Jaal-Yantra-Textiles/v2/commit/414e88ab383cdefe4cfafca055aabc2fbf9332e7))
* stripe card details ([b5a8023](https://github.com/Jaal-Yantra-Textiles/v2/commit/b5a8023355794247f7f28ce552ea8778f3f3ee7b))
* stripe checkout issues ([aac4741](https://github.com/Jaal-Yantra-Textiles/v2/commit/aac4741b4c23aad18e2c8f5e97f2c7301d969ca6))
* stripe ready context ([90423c5](https://github.com/Jaal-Yantra-Textiles/v2/commit/90423c59e5e701468a3c83145ae2ae21ec3a8555))
* stripe wrapper ([7b7fc56](https://github.com/Jaal-Yantra-Textiles/v2/commit/7b7fc563472cda1dce57418d909816308b389dd2))
* structure ([ffab067](https://github.com/Jaal-Yantra-Textiles/v2/commit/ffab0671b53f883a2e64b6cbe2af9efc95f855d8))
* subscription upgrade crash + partner notification 404s ([2ddb996](https://github.com/Jaal-Yantra-Textiles/v2/commit/2ddb9964ed2d2f08c541dc3a4351a6aa7669dd5b))
* Subtotal in cart is excl. taxes ([0c3d9f0](https://github.com/Jaal-Yantra-Textiles/v2/commit/0c3d9f00ed53645b5dfcdbd3325d1f3f0d887ac5))
* token types ([769f13b](https://github.com/Jaal-Yantra-Textiles/v2/commit/769f13b96c5595e4f229895abb8a0c59b4e360e7))
* tsc typing errors ([#519](https://github.com/Jaal-Yantra-Textiles/v2/issues/519)) ([4b1368d](https://github.com/Jaal-Yantra-Textiles/v2/commit/4b1368d26ee2a044669d8d10dc02fa6f1acb562f))
* tsc typing errors ([#519](https://github.com/Jaal-Yantra-Textiles/v2/issues/519)) ([014d0d0](https://github.com/Jaal-Yantra-Textiles/v2/commit/014d0d0471e52e4b17e27856fc06b5f25bb1c6f5))
* **zod:** two v4-only crashes uncovered by local boot ([a2716c9](https://github.com/Jaal-Yantra-Textiles/v2/commit/a2716c91e02d6e0b8446eebe0777138f9342ef92))
* type issues ([6bfdea7](https://github.com/Jaal-Yantra-Textiles/v2/commit/6bfdea73b976870836ae96a4b1a99e09521b7484))
* types ([ba71202](https://github.com/Jaal-Yantra-Textiles/v2/commit/ba7120269b289d33316b81e40e224dfb5d609b2f))
* typing for store product params ([#517](https://github.com/Jaal-Yantra-Textiles/v2/issues/517)) ([3aee1fd](https://github.com/Jaal-Yantra-Textiles/v2/commit/3aee1fd7973d259249d55ca85b774647463dc1e3))
* typing for store product params ([#517](https://github.com/Jaal-Yantra-Textiles/v2/issues/517)) ([f5465de](https://github.com/Jaal-Yantra-Textiles/v2/commit/f5465de7fb06baf6528cdb162f83458675f7d616))
* typo ([f38f0a4](https://github.com/Jaal-Yantra-Textiles/v2/commit/f38f0a4429952d2518431a936c4c377feb5eefe2))
* typo ([7f529c6](https://github.com/Jaal-Yantra-Textiles/v2/commit/7f529c6b4153434c73fac54cdc0d0aeadc1a024d))
* typo in get percentage diff ([#531](https://github.com/Jaal-Yantra-Textiles/v2/issues/531)) ([c7499a0](https://github.com/Jaal-Yantra-Textiles/v2/commit/c7499a06c3739ccd8eb10227f32a83996757bc62))
* **backend:** unblock Railway builds by clearing 3 TS errors on main ([103f093](https://github.com/Jaal-Yantra-Textiles/v2/commit/103f0931e01be13add5efccf801875a8f97955f5)), closes [#183](https://github.com/Jaal-Yantra-Textiles/v2/issues/183) [#192](https://github.com/Jaal-Yantra-Textiles/v2/issues/192)
* undo img size ([09c52e5](https://github.com/Jaal-Yantra-Textiles/v2/commit/09c52e57646010acf295a98c603c12c961244b7d))
* **e2e:** Update data-testid locators to correct spots, add additional data-testid locators ([7e27779](https://github.com/Jaal-Yantra-Textiles/v2/commit/7e2777902595c45e1e840e9dc1ccf922cc2eac66))
* update default BACKEND_URL ([eff86ec](https://github.com/Jaal-Yantra-Textiles/v2/commit/eff86ec318745053cf46d0c6d77bfcb865637cf3))
* **e2e:** update docs with env instructions and update default .env.example values ([1c4458d](https://github.com/Jaal-Yantra-Textiles/v2/commit/1c4458d2db6a948d83c7b6072203725215c5a910))
* update e2e test runner ([6547d6b](https://github.com/Jaal-Yantra-Textiles/v2/commit/6547d6b3c2d8d99ceff13d9fc7f519ad2e70048f))
* update featured products on region change ([10cfdfd](https://github.com/Jaal-Yantra-Textiles/v2/commit/10cfdfd04a84aba5ba1b3ca82d4c40bb80613f0d))
* update gitignore for IDEs ([b10a8cc](https://github.com/Jaal-Yantra-Textiles/v2/commit/b10a8ccf9c154c3af3e5a3d577b1161cb7cf4b4b))
* **partner-ui:** update inventory route paths and fallback to stocked_quantity ([90a634d](https://github.com/Jaal-Yantra-Textiles/v2/commit/90a634dbd1365120fb22514805975330ed215147))
* Update lockfile to include the latest rc ([0f8863f](https://github.com/Jaal-Yantra-Textiles/v2/commit/0f8863f746177ead25731e26aceaf7ac87e16dde))
* update README ([#6](https://github.com/Jaal-Yantra-Textiles/v2/issues/6)) ([9cf7561](https://github.com/Jaal-Yantra-Textiles/v2/commit/9cf7561f63098ffd4839006bfca2e8a6489f5c2c))
* update use of `@medusajs/medusa-js` ([#15](https://github.com/Jaal-Yantra-Textiles/v2/issues/15)) ([f12d32a](https://github.com/Jaal-Yantra-Textiles/v2/commit/f12d32ab6badb78ba87e422a574fc09bc6e618bb))
* upload thumbnail to S3 instead of sending data URL in design payload ([cc74764](https://github.com/Jaal-Yantra-Textiles/v2/commit/cc747647c600cb668ed10540a3fa2b390985c352))
* **scripts:** use --no-track and detect upstream-name mismatch ([4cae7aa](https://github.com/Jaal-Yantra-Textiles/v2/commit/4cae7aacaacd46050c511be3d43b11a5aed4825c))
* **middleware:** Use exact match for country code detection ([ed07f79](https://github.com/Jaal-Yantra-Textiles/v2/commit/ed07f79e07eef6c974dd57639646a91e8256d7de))
* use listCartOptions instead of list ([ce26793](https://github.com/Jaal-Yantra-Textiles/v2/commit/ce2679314405d0e08c1653f4bf1e6f8cfde65031))
* Use option IDs instead of titles ([ce46b6f](https://github.com/Jaal-Yantra-Textiles/v2/commit/ce46b6f5efb6dfbd34edf694c4cb478bb6ae2af2))
* **admin:** use react-router Link for customer link in abandoned cart detail ([d6e12b8](https://github.com/Jaal-Yantra-Textiles/v2/commit/d6e12b8db566563d69ca26b6dde2a4be94566de9))
* **admin:** use replace navigation after dashboard delete ([4f2b523](https://github.com/Jaal-Yantra-Textiles/v2/commit/4f2b52316b00ec762c875f51bfb1706e9e2c486e))
* use tag_ids instead of tags ([be62829](https://github.com/Jaal-Yantra-Textiles/v2/commit/be6282927b1ddafbe4b8f57e92d37c88c754f3f4))
* use tag_ids instead of tags ([#376](https://github.com/Jaal-Yantra-Textiles/v2/issues/376)) ([15c9692](https://github.com/Jaal-Yantra-Textiles/v2/commit/15c969228ef9edfe3a514f25137c1bbf129bdad3))
* **admin:** wire abandoned-carts FilterMenu values into the API call ([5e7354b](https://github.com/Jaal-Yantra-Textiles/v2/commit/5e7354bd279e62b06e70f25fd6ab7ccafda5ebc0))


### chore

* **backend:** upgrade Medusa from 2.13.6 to 2.14.0 ([e54043f](https://github.com/Jaal-Yantra-Textiles/v2/commit/e54043f333b25d8b3977140a7eb67414e47db94f))


### Features

* account and orders ([9b4b213](https://github.com/Jaal-Yantra-Textiles/v2/commit/9b4b2135e7306e887fd15ba23e54035629cff715))
* **backend/scripts:** add --new-branch flag to commit.sh and enhance push.sh with PR support ([55f64b1](https://github.com/Jaal-Yantra-Textiles/v2/commit/55f64b153f29ec4ecfdcce87441fa7211a5847fb))
* **partner-ui-i18n:** add --subsection support to translation script ([3f03bf0](https://github.com/Jaal-Yantra-Textiles/v2/commit/3f03bf000c9aaec420a3b442726522887c862c25))
* **google-merchant:** add actionable error classification and retry UI for preview failures ([fa2fa4d](https://github.com/Jaal-Yantra-Textiles/v2/commit/fa2fa4d5244208aa27ba37e21a23c260b5b48052))
* Add address handling with v2 API ([eb82a23](https://github.com/Jaal-Yantra-Textiles/v2/commit/eb82a235386632279c62980495d5d4755c034f9c))
* add App router and layout ([3ccbfc2](https://github.com/Jaal-Yantra-Textiles/v2/commit/3ccbfc2eb9ad8461b1c5a9f146833fe15ddf9c69))
* **stats:** add Cart Recovery dashboard powered by new cart_recovery_stats op ([eb6a74a](https://github.com/Jaal-Yantra-Textiles/v2/commit/eb6a74a2b08a78b063c99ab0ed092d3e1c9d4391))
* add collection filtering ([eedb4a4](https://github.com/Jaal-Yantra-Textiles/v2/commit/eedb4a4e462999b41b626eeed6cffe6d8edab894))
* **i18n:** add DashScope Qwen API support for translation script ([ec502da](https://github.com/Jaal-Yantra-Textiles/v2/commit/ec502dae16c35d2fa6594bd7d3cbe33e5623f8e2))
* **e2e:** add data seeding for giftcards and discounts, update user seeding ([8613b59](https://github.com/Jaal-Yantra-Textiles/v2/commit/8613b59a2fd1416712cacf87bebbc6e62873d10e))
* **google-merchant:** add data source management and existing product import ([c23e4ee](https://github.com/Jaal-Yantra-Textiles/v2/commit/c23e4ee8156026586b1a0efed56a8411bb81c215))
* **e2e:** add data-testids for discount related parts in checkout ([614b161](https://github.com/Jaal-Yantra-Textiles/v2/commit/614b161b983d9a52c544ebde1b2b3e1c399ef057))
* **e2e:** add data-testids to search components ([f270ff2](https://github.com/Jaal-Yantra-Textiles/v2/commit/f270ff2727181b3dc88b0093c7843896dfab16bb))
* Add debug mode to SDK ([9d8da89](https://github.com/Jaal-Yantra-Textiles/v2/commit/9d8da8974e6367b1fe58bbb14ce090abcc5554ad))
* **messaging:** add design + task pickers to payment-from-message modal ([50b1e87](https://github.com/Jaal-Yantra-Textiles/v2/commit/50b1e874c654c092f59354715cd853e222a7982c))
* **whatsapp-flow:** add design lookup and improve id validation in partner run flow ([48ccbd8](https://github.com/Jaal-Yantra-Textiles/v2/commit/48ccbd8ed84464de1533dcebaf18fecf79de6c29))
* add disable options on product page while loading ([9d13664](https://github.com/Jaal-Yantra-Textiles/v2/commit/9d136641646cda0d35b281ea7faa111f941dfc31))
* **production-runs:** add dispatch state guard and cost type handling ([5b159ef](https://github.com/Jaal-Yantra-Textiles/v2/commit/5b159ef4da9cfb0885cbf663b22e1f2a265cf66a))
* **website:** add domain alias management for storefront resolution ([2bceb8f](https://github.com/Jaal-Yantra-Textiles/v2/commit/2bceb8f182542a455a2ca4f769ef3fb978b18593))
* **media:** add drag-and-drop upload and date picker to media upload form ([e3e84b2](https://github.com/Jaal-Yantra-Textiles/v2/commit/e3e84b22b27069795483eca91df73dfea01f63de))
* add educational comments to api endpoints ([4673b59](https://github.com/Jaal-Yantra-Textiles/v2/commit/4673b596fb636dbdba4c0a218e2b288e27fa5d4b))
* add environment variables for S3 setup on Cloud ([#526](https://github.com/Jaal-Yantra-Textiles/v2/issues/526)) ([66f8fee](https://github.com/Jaal-Yantra-Textiles/v2/commit/66f8feeef2443e885cf6de4f4a1f8b15d832a5eb))
* add error handling on dynamic pages ([7d5d425](https://github.com/Jaal-Yantra-Textiles/v2/commit/7d5d425ae989f15ebfad65a9f3d2fd25e3a8f0c7))
* add feature toggle - product by handle ([b8efac8](https://github.com/Jaal-Yantra-Textiles/v2/commit/b8efac88c3e6ad9df701a298b302d92e2ad6bbd1))
* add feature toggle to all product fetches ([415a1c7](https://github.com/Jaal-Yantra-Textiles/v2/commit/415a1c78d2ad39aa42619f789be9274485ce3bd1))
* add free shipping nudge component ([74f9231](https://github.com/Jaal-Yantra-Textiles/v2/commit/74f9231b464a3a40d47c7965cf1d4af5a476db08))
* **google:** add full-jitter retry helper and wrap Google API calls ([9162f96](https://github.com/Jaal-Yantra-Textiles/v2/commit/9162f960bd98be619f0e35a33b1b6bbd5f00cd0c))
* **google-merchant:** add GCP project registration for Merchant Center accounts ([1ebbec6](https://github.com/Jaal-Yantra-Textiles/v2/commit/1ebbec6c456fa5b742bdbd042adaa630fd08177c))
* **social-platforms:** add Google Business Manager — OAuth, bindings, encrypted creds ([625e9ae](https://github.com/Jaal-Yantra-Textiles/v2/commit/625e9ae7069eb44f79e4c6b5b1562329fca08d1c))
* **partner-ui:** add Hindi language support and preferred_language field ([520fdde](https://github.com/Jaal-Yantra-Textiles/v2/commit/520fdded9ba27a931df130d7f66050c6892a41a7))
* **whatsapp:** add image mode to send-whatsapp operation and generate-partner-deeplink operation ([61ac96d](https://github.com/Jaal-Yantra-Textiles/v2/commit/61ac96dd8644b1e8c6dcb40b18ce73294618ab57))
* **google-merchant:** add import existing listings and bulk sync functionality ([d3d7f06](https://github.com/Jaal-Yantra-Textiles/v2/commit/d3d7f063ad1a4a11816a6e46d532e39231df46d6))
* **profile:** add language selection to edit profile form ([777f9dd](https://github.com/Jaal-Yantra-Textiles/v2/commit/777f9dda67a073a5767dc75a3c22acc6b24863e3))
* **partner-ui:** add location edit route and product variant media route ([d2aceed](https://github.com/Jaal-Yantra-Textiles/v2/commit/d2aceedafc15db6fae3ae26e46058824712bf17a))
* **workflow:** add meilisearch config and initialization ([98b8ece](https://github.com/Jaal-Yantra-Textiles/v2/commit/98b8ecebf3b9da567878588ccfbf192ae583b123))
* add meilisearch support ([0d1796a](https://github.com/Jaal-Yantra-Textiles/v2/commit/0d1796a17c643b73138028a808b14d81a3bded65))
* add meta imgs ([e8f96fa](https://github.com/Jaal-Yantra-Textiles/v2/commit/e8f96fafb68180d6dfcea2ca2b67d69c632b3e63))
* **partner-ui:** add metadata/edit routes for product variants, orders, categories, collections, and product types ([30665e4](https://github.com/Jaal-Yantra-Textiles/v2/commit/30665e4aac8fe2ab0fc961e8c02a6422573fbbfd))
* **admin:** add misconfiguration guards for stats panels ([bc2225b](https://github.com/Jaal-Yantra-Textiles/v2/commit/bc2225b2b8a829335d383c02efedfa83e643dd89))
* **production-runs:** add multi-language WhatsApp reminder templates and send-time language resolution ([3befcd6](https://github.com/Jaal-Yantra-Textiles/v2/commit/3befcd69dbefcd9da8dc4a8e182d60e027f4d292))
* add onboarding cat to product page ([9cccdf1](https://github.com/Jaal-Yantra-Textiles/v2/commit/9cccdf10b5ab5d478877931e8489f919d9dcffec))
* **e2e:** add orders page fixture ([f66f863](https://github.com/Jaal-Yantra-Textiles/v2/commit/f66f86326b4601d427d7bc04995f6857837279d7))
* **designs:** add parent run detection and dispatch logic for production runs ([f51a1c8](https://github.com/Jaal-Yantra-Textiles/v2/commit/f51a1c8797e929bb327fa405732db05d3cfa7960))
* add Partner Showcase section to homepage ([293fea6](https://github.com/Jaal-Yantra-Textiles/v2/commit/293fea62e2e1556eb9bc8aa8e7124798bb3f6695))
* add product category support ([773562e](https://github.com/Jaal-Yantra-Textiles/v2/commit/773562e1262dd32c9a1b3b4daf2224e119ac6092))
* **google-merchant:** add product takeover from Merchant Center UI ([fb61d42](https://github.com/Jaal-Yantra-Textiles/v2/commit/fb61d424b0bd4791448185a5f345544cc5dd703b))
* **whatsapp:** add production run reminder flows with per-day dedup and age labels ([16ff62a](https://github.com/Jaal-Yantra-Textiles/v2/commit/16ff62ad17d6d895ba52a14f1440b2935ba16ae3))
* **partner-ui:** add profile edit route and admin language management ([5b7c38e](https://github.com/Jaal-Yantra-Textiles/v2/commit/5b7c38ec293ac1876fe31c205a47f8e1341113df))
* **products:** add quick product creation flow for partners ([b909597](https://github.com/Jaal-Yantra-Textiles/v2/commit/b909597692c589a6c3f17cab15c74a0e5eec43bd))
* **scripts:** add reprovision-partner-storefront for targeted recovery ([d3fdb25](https://github.com/Jaal-Yantra-Textiles/v2/commit/d3fdb252e49f114259c5a37a0471ebc0b2da8257))
* add return types and category list to lib/data ([584c189](https://github.com/Jaal-Yantra-Textiles/v2/commit/584c1899be2f093a4880381dc00b1613c706401a))
* **e2e:** add search fixtures ([8816698](https://github.com/Jaal-Yantra-Textiles/v2/commit/8816698b934531cf10f35a2f76b3f6e4c15005c2))
* **stats:** add skeleton loading states for dashboard panels and detail page ([24dc1bb](https://github.com/Jaal-Yantra-Textiles/v2/commit/24dc1bb08dac29fedc7bb794f63446a109dda4f0))
* **config:** add stats module to production configuration ([941db88](https://github.com/Jaal-Yantra-Textiles/v2/commit/941db887899622baa4f9f972b293005ae0aa894b))
* **stats:** add stats panel extension and server-side data injection ([7b69504](https://github.com/Jaal-Yantra-Textiles/v2/commit/7b69504a44734ff3438f5a5e2a5c631ac7900413))
* add subcategory support ([01d32b2](https://github.com/Jaal-Yantra-Textiles/v2/commit/01d32b201f1351376516b78ad51cc646db001432))
* Add support for medusa payments ([73d9d81](https://github.com/Jaal-Yantra-Textiles/v2/commit/73d9d813715fe58bcb0563d98151b1775c315dc9))
* Add support for publishable key ([b5a806b](https://github.com/Jaal-Yantra-Textiles/v2/commit/b5a806bd79307377374d09e2e481661ad1a236e0))
* **google-merchant:** add sync jobs management and account editing ([7ab9927](https://github.com/Jaal-Yantra-Textiles/v2/commit/7ab9927757fe816887911f68de4e23d3cc73e8bd))
* **production-runs:** add task management hooks and update design task editing ([d91618e](https://github.com/Jaal-Yantra-Textiles/v2/commit/d91618e1f9c9c479c575ce5e70881de26f231893))
* add test-e2e command ([b324231](https://github.com/Jaal-Yantra-Textiles/v2/commit/b3242311e8d50bef7bab8a04dfd2cc1d1560b132))
* Add the cart complete call ([4e85fb8](https://github.com/Jaal-Yantra-Textiles/v2/commit/4e85fb8ed11ef6fe1b58d5153e91c14049027970))
* **google-merchant:** add token refresh functionality and health status display ([6591a5e](https://github.com/Jaal-Yantra-Textiles/v2/commit/6591a5e1ea81d4f83db33dc69b3cc8b5b39abae0))
* **backend,storefront:** add transfer cart on register and login ([256137c](https://github.com/Jaal-Yantra-Textiles/v2/commit/256137c7b9a189a0dc806c8bff8666015f0f6c6c))
* add updateDesign server action for PUT /store/custom/designs/:id ([2cfaec4](https://github.com/Jaal-Yantra-Textiles/v2/commit/2cfaec4b0c6cdfa0701f62691e93601aaaadcfe4))
* **partner:** add vercel_linked flag to gate storefront backfill ([70d874f](https://github.com/Jaal-Yantra-Textiles/v2/commit/70d874f8c6d96622ad514ad13e2faaa760a825b9))
* **social-platforms:** add WhatsApp Business Account ID and routing fields ([851212d](https://github.com/Jaal-Yantra-Textiles/v2/commit/851212d231e7676a40a0d2b7bbb19c2e1c0e72c5))
* **visual_flows:** add WhatsApp template language auditing and partner preference resolution ([dc492e7](https://github.com/Jaal-Yantra-Textiles/v2/commit/dc492e700bd80546a781cc8861c4e45641979b66))
* added no results state ([3bdc0ba](https://github.com/Jaal-Yantra-Textiles/v2/commit/3bdc0baf6ba5d3a032e89000dfd919c773b96a4c))
* **messaging:** admin "Create payment request from this message" ([942ee09](https://github.com/Jaal-Yantra-Textiles/v2/commit/942ee090df055da0bf8a51c164f1c37feb50b35f))
* **admin/production-runs:** allow admin cost field edits post-acceptance ([a584f51](https://github.com/Jaal-Yantra-Textiles/v2/commit/a584f510fd5ea1903be56b3a8fa914f5981a8aa5))
* axios fetch adapter ([9eeeb1d](https://github.com/Jaal-Yantra-Textiles/v2/commit/9eeeb1d6e2c85b218650a1bfc45a61a853d982a6))
* **marketing:** brands_live from websites + projected GMV ([52f3705](https://github.com/Jaal-Yantra-Textiles/v2/commit/52f37059a9b61665fdd4c89241c4676ccebaa1e1))
* **whatsapp:** bump reminder templates to _v2 with IMAGE header + uploader ([4822ff6](https://github.com/Jaal-Yantra-Textiles/v2/commit/4822ff61dc314f1f3bea1bc198bf3c29ddbb13c1)), closes [#164](https://github.com/Jaal-Yantra-Textiles/v2/issues/164)
* cache get functions in lib/data ([8423f57](https://github.com/Jaal-Yantra-Textiles/v2/commit/8423f575048bb73818ab3fc57707d0b5d7fd4c83))
* Changes to support selecting a shipping address and delivery ([8d85541](https://github.com/Jaal-Yantra-Textiles/v2/commit/8d85541eb240ae86c30525b23d55ba0eb14d958c))
* checkmarks on card form validation ([faa65e2](https://github.com/Jaal-Yantra-Textiles/v2/commit/faa65e21197ded249a4c33e928a500a19603e45c))
* Checkout flow w. prices and manual payment provider ([#7](https://github.com/Jaal-Yantra-Textiles/v2/issues/7)) ([79d8778](https://github.com/Jaal-Yantra-Textiles/v2/commit/79d8778132bfdc552110003299df5c6dc9666a64))
* **admin:** consolidate abandoned-carts filters into FilterMenu ([a18a0bb](https://github.com/Jaal-Yantra-Textiles/v2/commit/a18a0bb2eaebcde67eac1ee29a366edcf244087c))
* **ad-planning:** consult synced Google Ads campaigns in attribution ([bb0f8f1](https://github.com/Jaal-Yantra-Textiles/v2/commit/bb0f8f16a020b2560273745be57062305e4fdc0d))
* **ad-planning:** conversion detail page with Google Ads upload status + retry ([0b846d8](https://github.com/Jaal-Yantra-Textiles/v2/commit/0b846d8183c965840c61a03b0e8c240531eabc39))
* convert index and layout ([ff4cc73](https://github.com/Jaal-Yantra-Textiles/v2/commit/ff4cc73cd56178c0dd1c445894d71ff1ccc2f25d))
* core support, minor fixes ([3d6a460](https://github.com/Jaal-Yantra-Textiles/v2/commit/3d6a46018929d043da0832826de23374b93ca21e))
* default region from env ([762039f](https://github.com/Jaal-Yantra-Textiles/v2/commit/762039fea96b941b53c969624a9a5669560ea10a))
* **backend:** enable Medusa 2.14 optional packages + loyalty plugin ([5f6c598](https://github.com/Jaal-Yantra-Textiles/v2/commit/5f6c59894a9b974de709debd97c376f04adb4253))
* **whatsapp-webhook:** enhance logging and parsing for new message types ([1c233d4](https://github.com/Jaal-Yantra-Textiles/v2/commit/1c233d4429f2616f7cba4c193b3ba24270e958ad))
* **admin:** enhance social platform edit form with encrypted secret preservation and three-way boolean merge ([5261c23](https://github.com/Jaal-Yantra-Textiles/v2/commit/5261c231d4bec39f4391dd3137cf5c0729b066c3))
* **partner-store-products:** expose region-scoped price rules in product and variant responses ([13ae515](https://github.com/Jaal-Yantra-Textiles/v2/commit/13ae515bf63bd1b89e5b9a8a7237f18dbb912639))
* fetch dynamic prices on static product pages ([107f180](https://github.com/Jaal-Yantra-Textiles/v2/commit/107f180791baa890be9e162bb0dd2e21e050f501))
* filter draft products ([8bb6a23](https://github.com/Jaal-Yantra-Textiles/v2/commit/8bb6a232b0c10742feff9020a836fa542aa48a74))
* Fix customer authentication to work with v2 ([a7c453b](https://github.com/Jaal-Yantra-Textiles/v2/commit/a7c453be8366cc22674fdf81c846a75f35d9eb53))
* **abandoned-carts:** fix filter wiring + add visitor intent scoring ([436fab9](https://github.com/Jaal-Yantra-Textiles/v2/commit/436fab9e6fcece91d0bf187f5b4ae1ae64e39a82))
* Fixes and changes to the checkout page ([564371a](https://github.com/Jaal-Yantra-Textiles/v2/commit/564371a3d538468e3e52e66c64a623a7f96218cb))
* foramted address ([1a9eae1](https://github.com/Jaal-Yantra-Textiles/v2/commit/1a9eae10be235693b7882d3d3b191bae6d2d8950))
* **ad-planning:** goals admin UI with per-goal Google Ads mapping ([75f4062](https://github.com/Jaal-Yantra-Textiles/v2/commit/75f4062e364f54991f8c67b5c74b977d117df5a7))
* **forms:** guide dashboard, share-with-partner, segment locations ([054e756](https://github.com/Jaal-Yantra-Textiles/v2/commit/054e756cd18d6d45f2dd5d66072d261a1f6c2b73))
* handle free shipping in cart display ([#508](https://github.com/Jaal-Yantra-Textiles/v2/issues/508)) ([5d95aa0](https://github.com/Jaal-Yantra-Textiles/v2/commit/5d95aa0e8def272f4a53805484d7ed6ec7e5a034))
* handle free shipping in cart display ([#508](https://github.com/Jaal-Yantra-Textiles/v2/issues/508)) ([0ad5a8f](https://github.com/Jaal-Yantra-Textiles/v2/commit/0ad5a8feb95413c453fd5a841985241cf14bd305))
* has missing inventory, fix responsive ui ([9fbbf35](https://github.com/Jaal-Yantra-Textiles/v2/commit/9fbbf352d8d273d52891cd7d0e7001d9a29a39d6))
* **admin:** implement abandoned carts API hooks and admin routes ([cf23a7c](https://github.com/Jaal-Yantra-Textiles/v2/commit/cf23a7ca22d5e05368adcd5e84d1ef1df28a0190))
* **partner-portal:** implement AI-powered quick product creation with usage tracking ([47d3d65](https://github.com/Jaal-Yantra-Textiles/v2/commit/47d3d65064fede8b3347081bfee2a55255bb0120))
* **google-merchant:** implement product import workflow with preview and commit ([53871fc](https://github.com/Jaal-Yantra-Textiles/v2/commit/53871fc086fbde327d1f2c1833f685641251ff7d))
* Improve error reporting by adding resource ([8d71fc3](https://github.com/Jaal-Yantra-Textiles/v2/commit/8d71fc38941e671393075d31622b6981389af919))
* **partners:** in-app notification feed scoped by receiver_id ([4a39c72](https://github.com/Jaal-Yantra-Textiles/v2/commit/4a39c72ccecb98c479b39e7b9ca95a289b1b4eed))
* **flow-seeding:** include canvas_state in seeded flow definitions ([7c2c77b](https://github.com/Jaal-Yantra-Textiles/v2/commit/7c2c77bba292e1a1ee6e0529d8be001053a0a25a))
* **google-merchant:** integrate Google Merchant Center module with admin UI and API ([263c1aa](https://github.com/Jaal-Yantra-Textiles/v2/commit/263c1aa7aa9cb0ddef2fe4ca97a1c7b08e5ab714))
* **stats:** integrate stats module and visual flows analytics operations ([1a8f009](https://github.com/Jaal-Yantra-Textiles/v2/commit/1a8f009718500c1469da73b502e09f5000a911ff))
* language selector ([693521c](https://github.com/Jaal-Yantra-Textiles/v2/commit/693521c23107e6d096f484eacb02cfcdeb806408))
* Make cart v2 compatible ([69fd930](https://github.com/Jaal-Yantra-Textiles/v2/commit/69fd930da1f8e350c22b67edf8add6a9ea049171))
* Make region, collections, categories, and products v2 compatible ([f9a5193](https://github.com/Jaal-Yantra-Textiles/v2/commit/f9a51936879b113a0e10598cf8b23602cdd24151))
* **whatsapp:** media-header reminder templates + dynamic per-send image ([5ccfff2](https://github.com/Jaal-Yantra-Textiles/v2/commit/5ccfff28a049dc7d7ba7595907e5ede8da18909d))
* **marketing:** metrics gains gmv + new websites endpoint ([4a5ef43](https://github.com/Jaal-Yantra-Textiles/v2/commit/4a5ef43c9bbea752a0ce18b9440a63a725dce112))
* migrate 404 ([50152fd](https://github.com/Jaal-Yantra-Textiles/v2/commit/50152fd057707a6091a8b3db369e587e60942105))
* migrate cart ([961f12d](https://github.com/Jaal-Yantra-Textiles/v2/commit/961f12dc257ee4d0bf8766a32b2f085dcd2c3e43))
* migrate checkout ([1fa7b04](https://github.com/Jaal-Yantra-Textiles/v2/commit/1fa7b04d461e6d2423e0fc2b2a3ad80c98399576))
* migrate collections ([78377c2](https://github.com/Jaal-Yantra-Textiles/v2/commit/78377c2b2fa62591a059e451d49cdd2b2c201678))
* **google_merchant:** migrate from productInputs to products API and infer countries ([7160ecc](https://github.com/Jaal-Yantra-Textiles/v2/commit/7160ecc06ee54381d241fddf037e2333238c8116))
* migrate store ([570a482](https://github.com/Jaal-Yantra-Textiles/v2/commit/570a4824ab6df8deb7cfe7ce0ab320fa6dea122a))
* onboarding flow ([3c3745c](https://github.com/Jaal-Yantra-Textiles/v2/commit/3c3745c7adad4d7ee6ccbce083c5e289364d4255))
* open pickup method if selected on initial render ([b42d1f3](https://github.com/Jaal-Yantra-Textiles/v2/commit/b42d1f3dbdce9020f0c23bf1151ba604904097c1))
* options on product page ([1d30404](https://github.com/Jaal-Yantra-Textiles/v2/commit/1d30404f7133df8977cba0a64584a07cffc5f2a4))
* order pages ([45a07b7](https://github.com/Jaal-Yantra-Textiles/v2/commit/45a07b7b45b90e19b8759d4a12f929bcfc4bd472))
* order transfers  ([#411](https://github.com/Jaal-Yantra-Textiles/v2/issues/411)) ([414a2a2](https://github.com/Jaal-Yantra-Textiles/v2/commit/414a2a2cc798c173c031fe1e6f0f37582c4c1dd2))
* **whatsapp:** partner payment status flow — events, templates, seed ([d233b76](https://github.com/Jaal-Yantra-Textiles/v2/commit/d233b76e009e09e2d377a6eb735643c2c2c728b4)), closes [#178](https://github.com/Jaal-Yantra-Textiles/v2/issues/178) [#179](https://github.com/Jaal-Yantra-Textiles/v2/issues/179)
* **visual-flows:** partner-targeted notifications + local test script ([51c5388](https://github.com/Jaal-Yantra-Textiles/v2/commit/51c5388b9b4222a1d6a64ecb57a330d3f288a918))
* **whatsapp:** partners can upload to shared folders silently and query open work ([4ec187c](https://github.com/Jaal-Yantra-Textiles/v2/commit/4ec187c92aeaf4b93cb7d5f54f83713e0d91463d))
* **marketing:** per-domain marketing endpoints + Forms seed script ([32903e6](https://github.com/Jaal-Yantra-Textiles/v2/commit/32903e6d1ad006ea0b427b26f522bca434f6ba84))
* **websites:** per-website analytics provider config ([4dbb284](https://github.com/Jaal-Yantra-Textiles/v2/commit/4dbb28490510039fd40609576b2a058b86cbec6c))
* **forms:** pre-launch hardening — auth, idempotency, rate limit, ops ([7669777](https://github.com/Jaal-Yantra-Textiles/v2/commit/766977721b029b6278fac6f1d2f377d599768b37)), closes [#35](https://github.com/Jaal-Yantra-Textiles/v2/issues/35)
* pricing modul in products route ([80cf8ba](https://github.com/Jaal-Yantra-Textiles/v2/commit/80cf8ba3c7e6d862732c66e4b1ddf02d4a387c41))
* pricing module in categories and collections ([cc1cc2e](https://github.com/Jaal-Yantra-Textiles/v2/commit/cc1cc2ebd3d286602a6079f7ecc04886bd461e5b))
* product module ([6b684dd](https://github.com/Jaal-Yantra-Textiles/v2/commit/6b684ddcd1c57b711b397199b77c225a07a8d191))
* product page ([b2df1de](https://github.com/Jaal-Yantra-Textiles/v2/commit/b2df1def4f7f6fac51043b9aa557a0b1b81a2321))
* **google-merchant:** refactor auth flow and add batch variant pricing support ([9d66a67](https://github.com/Jaal-Yantra-Textiles/v2/commit/9d66a6727ffdc765bbc85ea29f045c14b76b67ee))
* related products skeleton ([f4663f2](https://github.com/Jaal-Yantra-Textiles/v2/commit/f4663f21986f0a000ccbbe477540a3f897d8afbb))
* **admin:** replace has_shipping filter with has_region for abandoned carts ([099b6e6](https://github.com/Jaal-Yantra-Textiles/v2/commit/099b6e659e1b1bc3b406055eae2a2cc7e3b213dd))
* Replace local SDK with js-sdk and replace all relevant types ([5577f80](https://github.com/Jaal-Yantra-Textiles/v2/commit/5577f80dc2b2f1f71348f56b8b0fd4a3f9fc31e7))
* **design-editor:** replace rectangle placeholder with fashion flat croquis ([ac679eb](https://github.com/Jaal-Yantra-Textiles/v2/commit/ac679ebf38091f86e9932d43dc862bc3b95d1bf2)), closes [#f7f8](https://github.com/Jaal-Yantra-Textiles/v2/issues/f7f8)
* **google-merchant:** replace window.confirm with usePrompt for all user confirmations ([5f18f7f](https://github.com/Jaal-Yantra-Textiles/v2/commit/5f18f7f8a5108d45b53a296d29319afd0c1b38dd))
* require publishable keys to run store endpoints ([3645882](https://github.com/Jaal-Yantra-Textiles/v2/commit/3645882a248f3be04b04b7bc18d953c54c4ae1bc))
* reset onboaridng on completion ([2fe7b12](https://github.com/Jaal-Yantra-Textiles/v2/commit/2fe7b12b9374f0333f474d301dfc85471075190e))
* **partner-ui:** rewire notification bell to partner-scoped API ([2df7bd7](https://github.com/Jaal-Yantra-Textiles/v2/commit/2df7bd7b3c3e924b3ed64998f742729544274aeb)), closes [#187](https://github.com/Jaal-Yantra-Textiles/v2/issues/187)
* **storefront:** Show design estimates in customer's local currency ([b39dd06](https://github.com/Jaal-Yantra-Textiles/v2/commit/b39dd06e80d933339d683c2713dc62a138d06d2b))
* **admin:** show synced Google Ads data on the GBM panel ([c90ed6c](https://github.com/Jaal-Yantra-Textiles/v2/commit/c90ed6c462916edbcc24bbb4c74a378ca018d85f))
* **storefront:** stamp visitor_id on cart at first add-to-cart ([42afd23](https://github.com/Jaal-Yantra-Textiles/v2/commit/42afd23a3eb7ee3b68062c00d3a124576686fa71))
* support calculated SO at checkout ([#436](https://github.com/Jaal-Yantra-Textiles/v2/issues/436)) ([4b1691e](https://github.com/Jaal-Yantra-Textiles/v2/commit/4b1691e8a0e57bcc7b612ca48e57672244050f3d))
* **visual-flows:** support replaying event_name for wildcard flows ([0f4681f](https://github.com/Jaal-Yantra-Textiles/v2/commit/0f4681f4971850e3f85eb634a05801937dd83302))
* **google-ads:** sync customers, campaigns, ad groups into local tables ([904eb85](https://github.com/Jaal-Yantra-Textiles/v2/commit/904eb859e6101f39f9385f641c99526e3f956a4d))
* **forms:** tour wizard polish + email confirmation + guide availability ([8e2ed6b](https://github.com/Jaal-Yantra-Textiles/v2/commit/8e2ed6b6d41787e1d1e97f93526fe8587259c9a6))
* **forms:** tour-type forms with itinerary planner + GYG xlsx import ([75161de](https://github.com/Jaal-Yantra-Textiles/v2/commit/75161de987e3ebdaade542bc43119c7eb86993c5))
* **google-ads:** UI for platform-level conversion-upload defaults ([27a335b](https://github.com/Jaal-Yantra-Textiles/v2/commit/27a335b93239aeb2412c656409fca4ee1ed47e03))
* **e2e:** update address modal and add data-testid locators ([a74289c](https://github.com/Jaal-Yantra-Textiles/v2/commit/a74289c248f46a9a2c7f93c5fd23dd58bba4805f))
* update api call for new category structure ([a917741](https://github.com/Jaal-Yantra-Textiles/v2/commit/a917741945c131571261d606ec0342ef45cdc96b))
* **e2e:** update data-testids for order related components ([33e0153](https://github.com/Jaal-Yantra-Textiles/v2/commit/33e0153169322cbf269e57080d3c8e9d65d3dde6))
* **e2e:** update fixtures for giftcard and discount related functionality ([36cf7e2](https://github.com/Jaal-Yantra-Textiles/v2/commit/36cf7e283bd730d186a8b98922e34d3300116621))
* **e2e:** Update order related fixtures ([6fea661](https://github.com/Jaal-Yantra-Textiles/v2/commit/6fea661567b8685f5c76fc9884d063d7c5a7c4bb))
* Update use of `@medusa/medusa-js` ([#13](https://github.com/Jaal-Yantra-Textiles/v2/issues/13)) ([5ce6b7a](https://github.com/Jaal-Yantra-Textiles/v2/commit/5ce6b7a8210e283bef0f9d9d5ea5d023994da132))
* **google-ads:** upload conversions to Google Ads with per-goal mapping ([9e05428](https://github.com/Jaal-Yantra-Textiles/v2/commit/9e05428f2f9190b10137b6c59c329ad09f4af7cf))
* upload design layer images to S3 instead of storing blob URLs ([9a39116](https://github.com/Jaal-Yantra-Textiles/v2/commit/9a3911648f919edc93e8f2b368f3d8d10b733a1b))
* use route groups ([85fbd32](https://github.com/Jaal-Yantra-Textiles/v2/commit/85fbd327c6ef3e91e27383d2845bbdcd98731032))
* use scoped-categories and scoped-collections endpoints ([b17c174](https://github.com/Jaal-Yantra-Textiles/v2/commit/b17c1743c438b63284da2f816419bda4ed1c5a82))
* v1 ([2c6c55e](https://github.com/Jaal-Yantra-Textiles/v2/commit/2c6c55e03fad86687be5bc9c7180c9175388a414))
* v1 ([21fad1e](https://github.com/Jaal-Yantra-Textiles/v2/commit/21fad1e87228f59df09d505ca81c527aca2db25d))
* variant scoped images ([#527](https://github.com/Jaal-Yantra-Textiles/v2/issues/527)) ([2d10a09](https://github.com/Jaal-Yantra-Textiles/v2/commit/2d10a0992e5a19f59854fadd624403969ba12d5a))
* Various fixes and code improvements ([ef41ddc](https://github.com/Jaal-Yantra-Textiles/v2/commit/ef41ddca38bc3753fd422ad844b5c67186ca55b9))
* **partner-ui:** webstore analytics settings page ([3154907](https://github.com/Jaal-Yantra-Textiles/v2/commit/3154907cb248313b3702603ea64dd5eb57026f38))
* **action:** write github action for running tests on new PR's ([936ef05](https://github.com/Jaal-Yantra-Textiles/v2/commit/936ef0546552476a7f2fcf6c38c3c7a071d8115f))


### Reverts

* Revert "update medusa deps (#94)" (#95) ([a755074](https://github.com/Jaal-Yantra-Textiles/v2/commit/a755074612d526aeb06627a60adc1e786aa64d13)), closes [#94](https://github.com/Jaal-Yantra-Textiles/v2/issues/94) [#95](https://github.com/Jaal-Yantra-Textiles/v2/issues/95)
* Revert "feat: Update use of `@medusa/medusa-js` (#13)" (#14) ([4c90fd2](https://github.com/Jaal-Yantra-Textiles/v2/commit/4c90fd264184948a8e89dc52832842532efd481d)), closes [#13](https://github.com/Jaal-Yantra-Textiles/v2/issues/13) [#14](https://github.com/Jaal-Yantra-Textiles/v2/issues/14)


### BREAKING CHANGES

* **backend:** ("Monorepo Project Structure for New Applications")
applies to fresh scaffolds via create-medusa-app — we adopted the
equivalent layout in Phase 3, so this is now a straight dep bump.

Bumped in apps/backend/package.json:
  @medusajs/admin-sdk          ^2.13.6 -> ^2.14.0
  @medusajs/admin-shared        2.13.6 ->  2.14.0
  @medusajs/cli                 2.13.6 ->  2.14.0
  @medusajs/framework           2.13.6 ->  2.14.0
  @medusajs/icons               2.13.6 ->  2.14.0
  @medusajs/index              ^2.13.6 -> ^2.14.0
  @medusajs/medusa              2.13.6 ->  2.14.0
  @medusajs/medusa-oas-cli     ^2.13.6 -> ^2.14.0
  @medusajs/ui                  4.1.6  ->  4.1.7
  @medusajs/workflows-sdk       2.13.6 ->  2.14.0
  @medusajs/test-utils (devDep) 2.13.6 ->  2.14.0

Verified locally: pnpm install resolves cleanly (peer warnings are
pre-existing and unchanged); pnpm --filter @jyt/backend exec medusa
--version reports CLI 2.14.0, site at apps/backend.

Note: the 2.14.0 reference template ships three new optional packages
(@medusajs/caching, @medusajs/dashboard, @medusajs/draft-order). They
are NOT pulled in here — they are feature additions, not required
upgrades, and can be adopted incrementally if/when needed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>

# [12.15.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v12.14.1...v12.15.0) (2026-04-18)


### Features

* **messaging:** add WhatsApp sender selection and persistence per conversation ([ad09acb](https://github.com/Jaal-Yantra-Textiles/v2/commit/ad09acb076879e1cc7d5d2383784f092305f344c))

## [12.14.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v12.14.0...v12.14.1) (2026-04-17)

# [12.14.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v12.13.0...v12.14.0) (2026-04-17)


### Features

* **deployment:** add Vercel ignore command support for storefront provisioning ([37fd129](https://github.com/Jaal-Yantra-Textiles/v2/commit/37fd129d5d0c190206a79f6fcf040588b17c008a))

# [12.13.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v12.12.0...v12.13.0) (2026-04-17)


### Features

* **admin:** add payment submission create flow ([496d982](https://github.com/Jaal-Yantra-Textiles/v2/commit/496d9823339ff11114396eff39eca2ef7c724c4d))

# [12.12.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v12.11.1...v12.12.0) (2026-04-16)


### Features

* **scripts:** add submodule-aware commit helper ([be4ca72](https://github.com/Jaal-Yantra-Textiles/v2/commit/be4ca720d7a7c60530ff811dac1efb0e21738fc5))

## [12.11.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v12.11.0...v12.11.1) (2026-04-16)


### Bug Fixes

* **api:** Bunch of storefront related changes ([473ad18](https://github.com/Jaal-Yantra-Textiles/v2/commit/473ad1828048dd7c4f40d9568253c619a9119cad))
* **api:** Fixed certain stuff in the whatsapp business administration ([177ec18](https://github.com/Jaal-Yantra-Textiles/v2/commit/177ec189e487aed0a489a4a02972e390f698aae0))

# [12.11.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v12.10.0...v12.11.0) (2026-04-15)


### Bug Fixes

* **api:** Energy cost seed and templates added ([85e8b4b](https://github.com/Jaal-Yantra-Textiles/v2/commit/85e8b4b57e00e71ddf3ceabefcdb3fa5f4b09fec))
* **Modules:** Fixed the module resolution ([9ef28aa](https://github.com/Jaal-Yantra-Textiles/v2/commit/9ef28aac6057fe9936dc6408333c1a60ecaee01b))


### Features

* **api:** Fixed the integration test and got the energy cost added ([e0ff81d](https://github.com/Jaal-Yantra-Textiles/v2/commit/e0ff81d76e4ec251a4daaf9766a2f8b6979a538a))

# [12.10.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v12.9.4...v12.10.0) (2026-04-14)


### Bug Fixes

* **api:** Fixed new api for the whatsapp sycn ([5372907](https://github.com/Jaal-Yantra-Textiles/v2/commit/5372907d2b37256459bc09ce8d9d22400d8e77be))
* **Migration:** fixed the migration and etc ([aae27c8](https://github.com/Jaal-Yantra-Textiles/v2/commit/aae27c8eb48247fd0ba4f28a12bbb88bc9d69354))


### Features

* **api:** We can now intitiate convo on the whatsapp ([90ab538](https://github.com/Jaal-Yantra-Textiles/v2/commit/90ab5383312bc5077fd9ecae90fd9875f7b3949f))

## [12.9.4](https://github.com/Jaal-Yantra-Textiles/v2/compare/v12.9.3...v12.9.4) (2026-04-14)


### Bug Fixes

* **admin:** UI fixes ([212cdee](https://github.com/Jaal-Yantra-Textiles/v2/commit/212cdeea383bd1d6ada8343f3a5fdf18a65b3c59))

## [12.9.3](https://github.com/Jaal-Yantra-Textiles/v2/compare/v12.9.2...v12.9.3) (2026-04-13)


### Bug Fixes

* **admin:** UI changes on the messages ([15cb00a](https://github.com/Jaal-Yantra-Textiles/v2/commit/15cb00acb5e9862e636654910252ca9abeee938b))
* **api:** Whats app business verification fixed ([32b2cb7](https://github.com/Jaal-Yantra-Textiles/v2/commit/32b2cb7f276eba218a1abbdb567b5dedf8e93eae))

## [12.9.2](https://github.com/Jaal-Yantra-Textiles/v2/compare/v12.9.1...v12.9.2) (2026-04-13)


### Bug Fixes

* **scripts:** Build script can now check the build on backend ([7d3c219](https://github.com/Jaal-Yantra-Textiles/v2/commit/7d3c219a2da8799a39dd5148e9d736cd4a679304))
* **api:** Fixed the ts errors ([a7ad6b5](https://github.com/Jaal-Yantra-Textiles/v2/commit/a7ad6b50b09ee03842a0adc215f5b933820d11a1))

## [12.9.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v12.9.0...v12.9.1) (2026-04-13)


### Bug Fixes

* **api:** Fixed whatsapp handler to behave nicel ([96fa7ad](https://github.com/Jaal-Yantra-Textiles/v2/commit/96fa7ad148af13b5d5fe7e92cf416a3ea045904f))

# [12.9.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v12.8.0...v12.9.0) (2026-04-12)


### Bug Fixes

* **api:** Medusa body parser ([bb62ce5](https://github.com/Jaal-Yantra-Textiles/v2/commit/bb62ce5cb3ad6b797451d1fb3bcf89089e160076))
* **admin:** Whatsapp feature for the external platform ([caaffa2](https://github.com/Jaal-Yantra-Textiles/v2/commit/caaffa28698192064161cf1a9f2420fd48689b8b))


### Features

* **api:** Whatsapp verify feature ([2a05b5f](https://github.com/Jaal-Yantra-Textiles/v2/commit/2a05b5f2b10e18f7bf56c71d3b00eab6c6084992))

# [12.8.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v12.7.0...v12.8.0) (2026-04-12)


### Bug Fixes

* **workflows:** Workflow type query fix ([4bc650f](https://github.com/Jaal-Yantra-Textiles/v2/commit/4bc650f17978d6e291ad82c0ecaa6fd621f4a7a0))


### Features

* **api:** We made the partner onboarding better ([b4bdbdc](https://github.com/Jaal-Yantra-Textiles/v2/commit/b4bdbdce8e2ae5d8a66bac7d0b76d072d263a6f2))

# [12.7.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v12.6.0...v12.7.0) (2026-04-11)


### Features

* **api:** Added partner ui and design related API improvments ([0e81055](https://github.com/Jaal-Yantra-Textiles/v2/commit/0e8105554bfbd612499f3e1d69e9116d70f1e933))

# [12.6.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v12.5.5...v12.6.0) (2026-04-10)


### Bug Fixes

* **api:** Schema and routes ([3eed434](https://github.com/Jaal-Yantra-Textiles/v2/commit/3eed434f628a0e9fc6f68db825afd61e33872312))


### Features

* **api:** Whatsapp standard messaging app ([06fddc9](https://github.com/Jaal-Yantra-Textiles/v2/commit/06fddc9c991973e0e1337c1a261615f71d5f72b9))

## [12.5.5](https://github.com/Jaal-Yantra-Textiles/v2/compare/v12.5.4...v12.5.5) (2026-04-10)


### Bug Fixes

* **api:** Ad planning fix ([3ac5557](https://github.com/Jaal-Yantra-Textiles/v2/commit/3ac555715a4d4007d05b3013d89bb148be350bb0))

## [12.5.4](https://github.com/Jaal-Yantra-Textiles/v2/compare/v12.5.3...v12.5.4) (2026-04-10)


### Bug Fixes

* **api:** Fixed the ad-planning segmentation ([81be013](https://github.com/Jaal-Yantra-Textiles/v2/commit/81be013529b1203791a4b83cf544d838451753b5))
* **workflows:** Fixed the query.graph of type any ([664a76d](https://github.com/Jaal-Yantra-Textiles/v2/commit/664a76d8baa29afbaaa12f5a965ff4c9adf51b3a))

## [12.5.3](https://github.com/Jaal-Yantra-Textiles/v2/compare/v12.5.2...v12.5.3) (2026-04-08)


### Bug Fixes

* **workflows:** Fixed the any type definition ([2bcba3b](https://github.com/Jaal-Yantra-Textiles/v2/commit/2bcba3b9f66c44e183694009ec35114ce65d486d))
* **api:** Fixed the type issues at the build ([5c0ad03](https://github.com/Jaal-Yantra-Textiles/v2/commit/5c0ad03843d91315a54da052f7147151b49b64d0))
* **api:** i enjoy stability ([a154eb8](https://github.com/Jaal-Yantra-Textiles/v2/commit/a154eb8d1ed61edfed738828147de1552f1e3d21))

## [12.5.2](https://github.com/Jaal-Yantra-Textiles/v2/compare/v12.5.1...v12.5.2) (2026-04-08)


### Bug Fixes

* **api:** Fixe the api and ui adming for the revised designe ([a631ccc](https://github.com/Jaal-Yantra-Textiles/v2/commit/a631cccfbc52108453521de84221206820383304))
* **CI:** Fixed the build issue ([51a1354](https://github.com/Jaal-Yantra-Textiles/v2/commit/51a1354e0cb8c96c2912c5e512cfdeb1fae06deb))

## [12.5.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v12.5.0...v12.5.1) (2026-04-06)


### Bug Fixes

* **api:** Fixed the command bar ([7dc5e6a](https://github.com/Jaal-Yantra-Textiles/v2/commit/7dc5e6a387abc3e6c7b632386f42bf6f6fd87802))

# [12.5.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v12.4.4...v12.5.0) (2026-04-06)


### Features

* **api:** Design end to end integration test with cart creation ([84448e2](https://github.com/Jaal-Yantra-Textiles/v2/commit/84448e212d80d8f51def24aebd6b665bc0c68444))

## [12.4.4](https://github.com/Jaal-Yantra-Textiles/v2/compare/v12.4.3...v12.4.4) (2026-04-05)


### Bug Fixes

* **workflows:** Fixed the cart order place. ([0203567](https://github.com/Jaal-Yantra-Textiles/v2/commit/020356724a1f6ac8807ca493844a42457f7f66b5))
* **api:** Fixed the require shipping part ([583fbe4](https://github.com/Jaal-Yantra-Textiles/v2/commit/583fbe44201cf245b103af88bce44d078fa4a782))

## [12.4.3](https://github.com/Jaal-Yantra-Textiles/v2/compare/v12.4.2...v12.4.3) (2026-04-03)


### Bug Fixes

* **api:** Change checkout URL to /api/cart/:id/checkout pattern ([e7e040b](https://github.com/Jaal-Yantra-Textiles/v2/commit/e7e040ba867cfeb230e850058d4550db5ee18948))


### Reverts

* Restore /checkout/cart/:id URL pattern ([e16ca7b](https://github.com/Jaal-Yantra-Textiles/v2/commit/e16ca7b02550749df8c901b6142e5e0471f68446))

## [12.4.2](https://github.com/Jaal-Yantra-Textiles/v2/compare/v12.4.1...v12.4.2) (2026-04-03)


### Bug Fixes

* **admin:** Add currency_code to design order detail and use cart currency for pending orders ([abab409](https://github.com/Jaal-Yantra-Textiles/v2/commit/abab40949996632cf61b3bcfd46b767a5f915c81))
* **api:** Fixed the workflow ([e1a5066](https://github.com/Jaal-Yantra-Textiles/v2/commit/e1a5066e51f72c98f5c76c1952500fd96b0ad762))

## [12.4.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v12.4.0...v12.4.1) (2026-04-03)


### Bug Fixes

* **api:** That's the fix -- 3 small changes: ([355b3fa](https://github.com/Jaal-Yantra-Textiles/v2/commit/355b3faa0f4d724257b9b05e8c53e6c881b5830c))

# [12.4.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v12.3.1...v12.4.0) (2026-04-01)


### Bug Fixes

* **admin:** Add override_currency support to design order UI ([c965e5a](https://github.com/Jaal-Yantra-Textiles/v2/commit/c965e5ac669250f06d91ed5469df2ffb125ad8e8))
* **api:** Add override_currency to design-order workflow and group design orders by cart ([ab44c9f](https://github.com/Jaal-Yantra-Textiles/v2/commit/ab44c9fd43557a80b7230213f997286192d6abd4))


### Features

* **api:** Add currency_code param to design estimate endpoint ([36d2557](https://github.com/Jaal-Yantra-Textiles/v2/commit/36d25577c1ea4a9fa9e0c254744b634d6793782e))

## [12.3.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v12.3.0...v12.3.1) (2026-03-30)


### Bug Fixes

* **api:** Sort all runs for the design by created_at DESC (newest first) ([b6670c4](https://github.com/Jaal-Yantra-Textiles/v2/commit/b6670c4a0898352e5c7296f72f95fb0048ade173))
* UI Fix at the partner UI ([2c123a5](https://github.com/Jaal-Yantra-Textiles/v2/commit/2c123a54cf894f73a9e5bc6da3e2c6f1f1aad36b))

# [12.3.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v12.2.0...v12.3.0) (2026-03-29)


### Bug Fixes

* **api:** Fixed the api to re-run production runs ([db4f3a0](https://github.com/Jaal-Yantra-Textiles/v2/commit/db4f3a041ff5134a066d53835f4f113a2e27bfb8))
* **api:** Fixed the partner and production run API ([6be8464](https://github.com/Jaal-Yantra-Textiles/v2/commit/6be8464ddacf87385de04119ca51098ef1358290))


### Features

* **whatsapp:** Add partner WhatsApp number, deep-link auth, and OTP verification ([702f523](https://github.com/Jaal-Yantra-Textiles/v2/commit/702f5237605ae707c737351aa3480ca2151bff11))
* **whatsapp:** Connect WhatsApp service to SocialPlatform for encrypted DB credentials ([974564c](https://github.com/Jaal-Yantra-Textiles/v2/commit/974564c1c9e387b4c2ca2d0ddd816f4db6b76b1b))

# [12.2.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v12.1.14...v12.2.0) (2026-03-28)


### Bug Fixes

* **Env Var:** Safely moved ([5842b88](https://github.com/Jaal-Yantra-Textiles/v2/commit/5842b88d6dab522b0ae903f4f87ebf06866f2007))


### Features

* **whatsapp:** Add WhatsApp integration for partner production run notifications ([5912089](https://github.com/Jaal-Yantra-Textiles/v2/commit/59120893798c7394fac958c7b66d5091ba9edc3e))

## [12.1.14](https://github.com/Jaal-Yantra-Textiles/v2/compare/v12.1.13...v12.1.14) (2026-03-28)


### Bug Fixes

* **api:** Low /high and priority fixes ([bb8ceee](https://github.com/Jaal-Yantra-Textiles/v2/commit/bb8ceee8b78cffa06cb1b0f789d7e05d71ae21b9))

## [12.1.13](https://github.com/Jaal-Yantra-Textiles/v2/compare/v12.1.12...v12.1.13) (2026-03-28)


### Bug Fixes

* **api:** API Changes (complete endpoint) ([a7ac81c](https://github.com/Jaal-Yantra-Textiles/v2/commit/a7ac81ca6feb5f6713ae56c15a8958b73440a062))

## [12.1.12](https://github.com/Jaal-Yantra-Textiles/v2/compare/v12.1.11...v12.1.12) (2026-03-28)


### Bug Fixes

* **api:** Complete endpoint now accepts unit_cost per consumption item ([a73156b](https://github.com/Jaal-Yantra-Textiles/v2/commit/a73156b94da0a007deeb6f1e684df078937f7908))

## [12.1.11](https://github.com/Jaal-Yantra-Textiles/v2/compare/v12.1.10...v12.1.11) (2026-03-26)


### Bug Fixes

* **api:** Fixed awaiting review ([9e895d1](https://github.com/Jaal-Yantra-Textiles/v2/commit/9e895d131427304ed974072d3febfbd15897e02f))
* **api:** Fixed the production run related details ([52c4b2e](https://github.com/Jaal-Yantra-Textiles/v2/commit/52c4b2e8463f74e52153cb273beb48100d329eae))
* **api:** Fixed the UI and Ux related fixe ([9050732](https://github.com/Jaal-Yantra-Textiles/v2/commit/905073246646f88471b62904fb4351a38d5b5e23))
* **workflows:** Workflow missing the template key ([9c6937c](https://github.com/Jaal-Yantra-Textiles/v2/commit/9c6937ca9de3c86f43c74ec816e7e82220c621ba))

## [12.1.10](https://github.com/Jaal-Yantra-Textiles/v2/compare/v12.1.9...v12.1.10) (2026-03-26)


### Bug Fixes

* **docs:** Ficed the bugs ([47b6c26](https://github.com/Jaal-Yantra-Textiles/v2/commit/47b6c260e0b68af80f699823127a58a3fd6093f0))
* **api:** Raw Material unit cost ([1f407ef](https://github.com/Jaal-Yantra-Textiles/v2/commit/1f407ef660b1ca580bc5fbf2c307586d9b52f839))

## [12.1.9](https://github.com/Jaal-Yantra-Textiles/v2/compare/v12.1.8...v12.1.9) (2026-03-26)


### Bug Fixes

* **api:** Cancel parent run and individual run ([f2b2da4](https://github.com/Jaal-Yantra-Textiles/v2/commit/f2b2da4fc10f34bf5d4aaf6eb90010f45666c201))
* **api:** Fixed the consumption log at the final ([18f7db9](https://github.com/Jaal-Yantra-Textiles/v2/commit/18f7db971c6bb9dacc9758c3d4a8e62c0507e4ed))
* **api:** Fixed the partner consumption logging ([9d01f01](https://github.com/Jaal-Yantra-Textiles/v2/commit/9d01f01765e2ce2ba7edaef8949736c46aec4bcc))
* **api:** Fixed the production log typescript error ([8734474](https://github.com/Jaal-Yantra-Textiles/v2/commit/87344747982fe862c620508ee4baff17933ad6fe))
* **admin:** Fixed the production run related API and UI ([1990cc9](https://github.com/Jaal-Yantra-Textiles/v2/commit/1990cc9be767e575a71baa5394b1faefb3fb3fa7))

## [12.1.8](https://github.com/Jaal-Yantra-Textiles/v2/compare/v12.1.7...v12.1.8) (2026-03-25)


### Bug Fixes

* **api:** Fixed the cancel guard ([f2147b7](https://github.com/Jaal-Yantra-Textiles/v2/commit/f2147b7ee88373859c066bcb69743b8cd121cf2a))
* **api:** Fixed the partner send to design stuff ([c0dcaa3](https://github.com/Jaal-Yantra-Textiles/v2/commit/c0dcaa3066b0d44bde9dfbd2bf9fd89d9ec29bf3))
* **api:** Fixed the UI and prod run cancel workflow ([e891064](https://github.com/Jaal-Yantra-Textiles/v2/commit/e89106418e29e2e323f4a0e498b5e33a13476b31))

## [12.1.7](https://github.com/Jaal-Yantra-Textiles/v2/compare/v12.1.6...v12.1.7) (2026-03-25)


### Bug Fixes

* Fix 1: Manage Locations — partner-scoped stock locations ([fedae4e](https://github.com/Jaal-Yantra-Textiles/v2/commit/fedae4ee265c3565ce0b88b2a30465f62c331f8f))
* **api:** Fixed reservation api related , products variant and etc ([02d4842](https://github.com/Jaal-Yantra-Textiles/v2/commit/02d4842a64e9c158f80bce81a9c5af28b9c258ab))
* **api:** New: Partner-scoped Reservations API ([ff6af03](https://github.com/Jaal-Yantra-Textiles/v2/commit/ff6af032b21e96401fb8e86e971f73ab32131af0))

## [12.1.6](https://github.com/Jaal-Yantra-Textiles/v2/compare/v12.1.5...v12.1.6) (2026-03-25)


### Bug Fixes

* **api:** Currency Conversion ([2c0a3fa](https://github.com/Jaal-Yantra-Textiles/v2/commit/2c0a3fa8856f01500da9f6284296e9deda72852a))
* **admin:** Fixed the partner to show the send or not send ([47ffa36](https://github.com/Jaal-Yantra-Textiles/v2/commit/47ffa36ccd81748a11b841dd539517b07104753e))
* **api:** Fixed the prodution sectoin in the partner ui ([d6408a1](https://github.com/Jaal-Yantra-Textiles/v2/commit/d6408a1395d8a1e6ca4b126c229d6013e48eca8c))

## [12.1.5](https://github.com/Jaal-Yantra-Textiles/v2/compare/v12.1.4...v12.1.5) (2026-03-24)


### Bug Fixes

* **api:** Ad PLanning some API were missing ([4a7b0ff](https://github.com/Jaal-Yantra-Textiles/v2/commit/4a7b0ff0928102c67666ee7558a2020ca4e4257d))

## [12.1.4](https://github.com/Jaal-Yantra-Textiles/v2/compare/v12.1.3...v12.1.4) (2026-03-24)


### Bug Fixes

* **api:** Fixed the customer updates ([4071fb8](https://github.com/Jaal-Yantra-Textiles/v2/commit/4071fb8e056188fbe3151e3f10b9000f874aa8f4))
* **workflows:** Fixed the when guards ([512d041](https://github.com/Jaal-Yantra-Textiles/v2/commit/512d041441463fb511e77039c6c7197a1b85449a))

## [12.1.3](https://github.com/Jaal-Yantra-Textiles/v2/compare/v12.1.2...v12.1.3) (2026-03-24)


### Bug Fixes

* **docs:** Entering bug fixes ([95189ab](https://github.com/Jaal-Yantra-Textiles/v2/commit/95189ab25700ede1b3b6aa8acf04dac218f30830))
* **api:** Fixed the production runs ([f89ae6b](https://github.com/Jaal-Yantra-Textiles/v2/commit/f89ae6babcf2b3aaa0064f967de4a50a6f113e58))

## [12.1.2](https://github.com/Jaal-Yantra-Textiles/v2/compare/v12.1.1...v12.1.2) (2026-03-24)


### Bug Fixes

* **workflows:** Fixed the maileroo ([ba066a8](https://github.com/Jaal-Yantra-Textiles/v2/commit/ba066a86c0343e2c6273ce0a1d5db508b7c47120))

## [12.1.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v12.1.0...v12.1.1) (2026-03-23)


### Bug Fixes

* **admin:** Fixed the email templating issue ([0002d72](https://github.com/Jaal-Yantra-Textiles/v2/commit/0002d72d918549c324639e9a9598a69d7d144676))

# [12.1.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v12.0.0...v12.1.0) (2026-03-23)


### Features

* **admin:** Adding the category dropdown values ([452abef](https://github.com/Jaal-Yantra-Textiles/v2/commit/452abef8e1e9bc9c0b7141b177f27d78af270130))

# [12.0.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v11.1.0...v12.0.0) (2026-03-23)


### Bug Fixes

* **admin:** Adding more fields at the design printing stuff ([e16294c](https://github.com/Jaal-Yantra-Textiles/v2/commit/e16294cf74a447770f0e2324cc752b49aff27b3d))
* **admin:** Images were getting cut across page breaks because: ([c3bc29d](https://github.com/Jaal-Yantra-Textiles/v2/commit/c3bc29d92da715dc26d73fbbb9ffa4ec650f7147))
* **admin:** Moodboard raster images ([2412327](https://github.com/Jaal-Yantra-Textiles/v2/commit/2412327ba11513500c4d3da02e964ffd3ee5c0ca))


### Features

* **api:** Fixed the build issues ([fe5837a](https://github.com/Jaal-Yantra-Textiles/v2/commit/fe5837af22a80200528e5d88bd6967cb09f4e673))
* **api:** Inventory Import using data grid ([db92a6f](https://github.com/Jaal-Yantra-Textiles/v2/commit/db92a6f0ac1a12806923ead718e8f39272bf1959))


### BREAKING CHANGES

* **api:**

# [11.1.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v11.0.0...v11.1.0) (2026-03-22)


### Bug Fixes

* **admin:** Fixed the issue for the data table ([0a63e9e](https://github.com/Jaal-Yantra-Textiles/v2/commit/0a63e9ec51f4fcd65ad42efdbb6609dc41c4d712))
* **workflows:** Fixed the mailjet settings ([fb84953](https://github.com/Jaal-Yantra-Textiles/v2/commit/fb84953e585f3b81bf98cb84b84a5f2417f7ab84))


### Features

* **api:** Built designs logs for the samples ([309a1ac](https://github.com/Jaal-Yantra-Textiles/v2/commit/309a1ac19b725045875861b7c52ff4d13bb647e4))
* **admin:** UI features to send partner in batches ([69437a3](https://github.com/Jaal-Yantra-Textiles/v2/commit/69437a3a628edb8aecf2bb266c84c8635a8e593f))

# [11.0.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v10.18.1...v11.0.0) (2026-03-22)


### Bug Fixes

* **api:** Fixed the graph catch all api issue ([e779fbc](https://github.com/Jaal-Yantra-Textiles/v2/commit/e779fbc8a98cb09d1a0d4a73293d5c6d863867fc))
* **admin:** Fixed the url path for image loading the Moodboard ([6e1c24d](https://github.com/Jaal-Yantra-Textiles/v2/commit/6e1c24de4d0d4dd8550f314e3ee38aa308e8fd6e))
* **admin:** refreshCanvasImages now: ([5c4f611](https://github.com/Jaal-Yantra-Textiles/v2/commit/5c4f6117f3f9d11fec0875ba178c72045529a3fd))


### BREAKING CHANGES

* **admin:**

## [10.18.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v10.18.0...v10.18.1) (2026-03-22)


### Bug Fixes

* **api:** Fixed image loading ([bb00ba7](https://github.com/Jaal-Yantra-Textiles/v2/commit/bb00ba7a4a7756edbd621b5ec794eeacd0073ef4))
* **admin:** Fixed it to handle the existing image ([3bfed8a](https://github.com/Jaal-Yantra-Textiles/v2/commit/3bfed8aae44234e5351a96a797514d0bd0a41320))
* **admin:** Fixed the excalidraw ([a0f0add](https://github.com/Jaal-Yantra-Textiles/v2/commit/a0f0addb4d230cfcecc3b5f958c7c365c5f0605a))

# [10.18.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v10.17.3...v10.18.0) (2026-03-22)


### Bug Fixes

* **admin:** Custom design preview ([d7f824c](https://github.com/Jaal-Yantra-Textiles/v2/commit/d7f824ce631925c625d484a71becc0c418e54861))
* **admin:** Fixed the poreview route ([ad6e389](https://github.com/Jaal-Yantra-Textiles/v2/commit/ad6e389279620df731231b9b90577a78bfad65dc))
* **api:** Fixed the printing ([790112e](https://github.com/Jaal-Yantra-Textiles/v2/commit/790112ecd9faeefb9d9d763def235ffb74a99cb5))


### Features

* **api:** moodboard sending cutout ([14b2577](https://github.com/Jaal-Yantra-Textiles/v2/commit/14b25773bdec6ed7356b87e492af518858097d6f))

## [10.17.3](https://github.com/Jaal-Yantra-Textiles/v2/compare/v10.17.2...v10.17.3) (2026-03-22)


### Bug Fixes

* **workflows:** blog-key set ([412bac4](https://github.com/Jaal-Yantra-Textiles/v2/commit/412bac4365600ea2f7fc18033e9fe0584ecac210))
* **workflows:** Build passed clean. All three TS errors fixed: ([833ae0b](https://github.com/Jaal-Yantra-Textiles/v2/commit/833ae0bfc683b97ce29a916f14f8ec2a220569f6))
* **workflows:** Fixed the template processing ([7789eb4](https://github.com/Jaal-Yantra-Textiles/v2/commit/7789eb44842f4d87f92692eb6d6f145259e1bd60))

## [10.17.2](https://github.com/Jaal-Yantra-Textiles/v2/compare/v10.17.1...v10.17.2) (2026-03-21)


### Bug Fixes

* **api:** Fixed code workflow error ([addf9c0](https://github.com/Jaal-Yantra-Textiles/v2/commit/addf9c01ac36ddcee10a39501dddfe1a47a4a79c))
* **api:** Fixed mailjet and distribution load ([5f371f4](https://github.com/Jaal-Yantra-Textiles/v2/commit/5f371f42c3bf0efbd0e89e9d49129a9c8f35eeeb))
* **api:** Fixed the payment providers and return and refunds ([d11c797](https://github.com/Jaal-Yantra-Textiles/v2/commit/d11c79700b335a20a578e64376403aa6c7e2981b))
* **api:** Fixed the regin, providers ([3dfeca0](https://github.com/Jaal-Yantra-Textiles/v2/commit/3dfeca0fbee28d6fb902cdb76b83580219ac9836))
* **api:** Fixed the return reason link service ([d361b2c](https://github.com/Jaal-Yantra-Textiles/v2/commit/d361b2cb5f34673eb6eb53967bde2867369a4abb))
* **api:** Partners can now add subsc and delete them ([fd35d76](https://github.com/Jaal-Yantra-Textiles/v2/commit/fd35d76a4e290ae487ee726c368df1fab686fa5b))
* **api:** Payment provider to config ([01a6488](https://github.com/Jaal-Yantra-Textiles/v2/commit/01a648875aa04644c4068b56d4383a717289b20e))

## [10.17.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v10.17.0...v10.17.1) (2026-03-21)


### Bug Fixes

* **workflows:** 500 errors are gone ([103197d](https://github.com/Jaal-Yantra-Textiles/v2/commit/103197d2a972b9b13df8addcd9fae69708d9ca66))
* **api:** Fixed the metadata to use the theme data ([182ac12](https://github.com/Jaal-Yantra-Textiles/v2/commit/182ac1254957b3f707077c122e5b6c98e80faea8))
* **Api:** Fixed the partner Update ([7111e73](https://github.com/Jaal-Yantra-Textiles/v2/commit/7111e733f3d12d50fdd9ac3ae3c1cc065e49981c))

# [10.17.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v10.16.0...v10.17.0) (2026-03-21)


### Bug Fixes

* **api:** Animation editor fix ([d8acdaf](https://github.com/Jaal-Yantra-Textiles/v2/commit/d8acdafbae1e5304067e23e7fb501f18aaabeae3))


### Features

* **api:** Product Design Page Matches the layout ([0df86e9](https://github.com/Jaal-Yantra-Textiles/v2/commit/0df86e98c3c1e3b1b077df461d63a27324fc4f6b))

# [10.16.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v10.15.0...v10.16.0) (2026-03-21)


### Features

* **api:** Admin can now send designs ([7b508a2](https://github.com/Jaal-Yantra-Textiles/v2/commit/7b508a2c813bc9fcccec4b60204cdf36a1908f17))

# [10.15.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v10.14.2...v10.15.0) (2026-03-20)


### Features

* **api:** A new way to create the order ([8e0fc81](https://github.com/Jaal-Yantra-Textiles/v2/commit/8e0fc81bff9c0cf6621f33cf2162c3ea1e5c750e))

## [10.14.2](https://github.com/Jaal-Yantra-Textiles/v2/compare/v10.14.1...v10.14.2) (2026-03-20)


### Bug Fixes

* **api:** Fixed a lot of bugs, including the Shipping Creation using delhivery ([8036f8e](https://github.com/Jaal-Yantra-Textiles/v2/commit/8036f8e1f3e586e2baba335d13886ce650179f44))

## [10.14.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v10.14.0...v10.14.1) (2026-03-20)


### Bug Fixes

* **api:** Fixed some ui related issues ([19e76da](https://github.com/Jaal-Yantra-Textiles/v2/commit/19e76da9dc5cca2b6cd092939d7807e1e175882a))
* **Partner UI:** Z-index at the discover product pages ([452741b](https://github.com/Jaal-Yantra-Textiles/v2/commit/452741b37b16319333f35a8343761ed6427742c9))

# [10.14.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v10.13.0...v10.14.0) (2026-03-20)


### Features

* **Partner:** Now you can edit the entire website ([dde594a](https://github.com/Jaal-Yantra-Textiles/v2/commit/dde594a00e314cb9ca639e74154426b1da522924))

# [10.13.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v10.12.3...v10.13.0) (2026-03-20)


### Bug Fixes

* **api:** 1. fulfillmentService.listFulfillmentOptions is not a function ([3a6bcab](https://github.com/Jaal-Yantra-Textiles/v2/commit/3a6bcaba499f483a219f4248020323e5475d4407))
* **Root cause of the 400: The postal codes being passed aren't valid 6-digit Indian pincodes. Delhivery is India-only — if a storefront checkout has a US zip code like 10001 (5 digits) or a UK postcode like SW1A:** 1AA, the API rejects it with 400. ([6a74863](https://github.com/Jaal-Yantra-Textiles/v2/commit/6a74863a8a54e02add58e6afafc84adf9c2b514f))
* **api:** A lot of stuff on the train ([15a213d](https://github.com/Jaal-Yantra-Textiles/v2/commit/15a213d86e03eab206baa253d0d76ecbfc68d5d0))
* add .gitmodules for storefront-starter submodule ([c118c7b](https://github.com/Jaal-Yantra-Textiles/v2/commit/c118c7be05453143fa69a7a655a71808d7fc0c94))
* **api:** Build fix ([ee4fdfa](https://github.com/Jaal-Yantra-Textiles/v2/commit/ee4fdfa16d619329795131da3ae6cf414a9d6a7a))
* **api:** category fix ([869897c](https://github.com/Jaal-Yantra-Textiles/v2/commit/869897c7015b3c550ca1680f317ea8cc7c1a9138))
* **api:** Changing the partners api ([7f98ffd](https://github.com/Jaal-Yantra-Textiles/v2/commit/7f98ffd76abb8879c15b03bbe598de8b5062f538))
* **api:** Fix — auto-derives S3 config from existing backend env vars and passes to Vercel: ([c200b37](https://github.com/Jaal-Yantra-Textiles/v2/commit/c200b37880bed0f8e4517180334b289484b3028b))
* **workflows:** Fix: 5 Delhivery options → 1 ([083bad1](https://github.com/Jaal-Yantra-Textiles/v2/commit/083bad18ac6363ffc1d362892f9e3b3970d1e6fa))
* **api:** Fixed a lot of bugs ([62cf975](https://github.com/Jaal-Yantra-Textiles/v2/commit/62cf975e78776adcb08758b1c5ff725f98fbfc0e))
* **admin:** Fixed admin and store distinction ([824d6f6](https://github.com/Jaal-Yantra-Textiles/v2/commit/824d6f67f4bcb4b98b0aea182dbd494874310120))
* **api:** Fixed id typescirpt ([f512b5c](https://github.com/Jaal-Yantra-Textiles/v2/commit/f512b5cebe54d96ad07c654f0a42d1fede01eb06))
* **api:** Fixed many bugs ([a1e89fa](https://github.com/Jaal-Yantra-Textiles/v2/commit/a1e89fabbcf2876916ed58540a2533985a5da3ad))
* **partnerui:** Fixed many things like production runs and etc ([b185d41](https://github.com/Jaal-Yantra-Textiles/v2/commit/b185d4124395e1ea178cb2263783da0785868410))
* **api:** Fixed many things ([1055c5b](https://github.com/Jaal-Yantra-Textiles/v2/commit/1055c5b102b7236c3b73b4184850e068cd5b439d))
* **api:** Fixed the decimal value system ([9376d7b](https://github.com/Jaal-Yantra-Textiles/v2/commit/9376d7b2cf64b87e950c516fb54310f2e31936c3))
* **api:** Fixed the issue inside the delhivery data delivery ([470bb0a](https://github.com/Jaal-Yantra-Textiles/v2/commit/470bb0a4003e5f3b5ef7a9633569697f431b1ea7))
* **api:** Fixed the module config ([e33769d](https://github.com/Jaal-Yantra-Textiles/v2/commit/e33769d844380955b2ae7cf37af7feb0abeb0704))
* **api:** Fixed the object deletion ([55645c0](https://github.com/Jaal-Yantra-Textiles/v2/commit/55645c06bc3b901556366958ee449480d4c7e8c2))
* **workflows:** Fixed the transform ([1196886](https://github.com/Jaal-Yantra-Textiles/v2/commit/11968866dd09b3f9e8a837b1da18f747bdaa2666))
* **api:** listPageWorkflow was not filtering by website_id ([2532a10](https://github.com/Jaal-Yantra-Textiles/v2/commit/2532a102139d57d47a60c59d408cb7915afe9d2a))
* **api:** Loggin the current admin ([d5f4859](https://github.com/Jaal-Yantra-Textiles/v2/commit/d5f4859be1ba455928ecca4ed7ad8850d5e229a5))
* **api:** make website_id required in listPageWorkflow, always filter by it ([d4b4975](https://github.com/Jaal-Yantra-Textiles/v2/commit/d4b4975c699c16896a742a8bab91c2f8d9478ff8))
* **workflows:** Now revert the step back to the cleaner signature and use transform in the workflow. ([e78cda4](https://github.com/Jaal-Yantra-Textiles/v2/commit/e78cda4837db0be4106f00faf45ce1422b354f0a))
* **api:** Partner API matching ([fe7150e](https://github.com/Jaal-Yantra-Textiles/v2/commit/fe7150e1643781f7871bcb949b171b566c829bcc))
* **workflows:** Partner fulfilment setting ([b39249c](https://github.com/Jaal-Yantra-Textiles/v2/commit/b39249c54f28220d05b039b52111edb98988dfc5))
* **api:** Partner level inventory scoping ([032e8ef](https://github.com/Jaal-Yantra-Textiles/v2/commit/032e8ef176ba31bb8c1aada68a4e1a0541dd6213))
* **tests:** Partner scoped tests ([dc920df](https://github.com/Jaal-Yantra-Textiles/v2/commit/dc920df89e12ab49a9b2594a4703ac13a1819381))
* **tests:** Partner tests ([270c0dc](https://github.com/Jaal-Yantra-Textiles/v2/commit/270c0dcf197e7b81da54488ba439faaea9def636))
* **api:** Partner UI fixes ([5ab964b](https://github.com/Jaal-Yantra-Textiles/v2/commit/5ab964b2dff11cb9ef391bd2fd271058d549e280))
* **scripts:** Partner UI ([87a744b](https://github.com/Jaal-Yantra-Textiles/v2/commit/87a744bb2cb75826d5d0225d146d1ffc5acc7090))
* **api:** Partner workflows replaced ([bad03c0](https://github.com/Jaal-Yantra-Textiles/v2/commit/bad03c08bcdcb6fb892466e10377dd1fa2c2d505))
* **api:** production runs showing wrong data ([64fecb8](https://github.com/Jaal-Yantra-Textiles/v2/commit/64fecb818e85140dd7242edef3435155ab58fbfe))
* Progress Type script error ([265214e](https://github.com/Jaal-Yantra-Textiles/v2/commit/265214e60c332ea416e617f0a7d6fbd6d919218e))
* **partner-ui:** proper content flow — store check, storefront check, create pages ([954569e](https://github.com/Jaal-Yantra-Textiles/v2/commit/954569e78fd537fae44bb3e897b9b70b3bcf2ec7))
* **partner-ui:** replace SingleColumnPage with div in content list ([c6053e2](https://github.com/Jaal-Yantra-Textiles/v2/commit/c6053e2d2821262a5ceabc062353086607ae9838))
* **api:** revert workflow change, pass website_id in partner route filters ([d9497b9](https://github.com/Jaal-Yantra-Textiles/v2/commit/d9497b9f096b88a22f85298c84d6d18c3608544d))
* **Partner:** Root cause: The design detail page was reading from wrong data paths: ([6c66745](https://github.com/Jaal-Yantra-Textiles/v2/commit/6c6674598a046b2dd50bbc20f4223efdd3d8a9e7))
* **api:** Route Focus Moda and other Api fix ([3b36d8e](https://github.com/Jaal-Yantra-Textiles/v2/commit/3b36d8eff980b52cb423df6dee08702bff7ad15b))
* **api:** Sub Domain Fix ([8303a69](https://github.com/Jaal-Yantra-Textiles/v2/commit/8303a6922fd65df2039133d436dfd4804978a4bc))
* TypeScript issues in partner website route and admin pages route ([d2924b7](https://github.com/Jaal-Yantra-Textiles/v2/commit/d2924b7161e4407f8435b649dfc075237cd72ec3))
* **partner-ui:** use DataTable pattern for content list matching other routes ([380389d](https://github.com/Jaal-Yantra-Textiles/v2/commit/380389dad7e75590ee3eade0536f2325220fa589))
* **api:** use retrieveFulfillmentOptions instead of non-existent listFulfillmentOptions ([188197b](https://github.com/Jaal-Yantra-Textiles/v2/commit/188197b33bd3df634f13e219e0f660fb53dd6710))
* **api:** use website_id in partner metadata for direct website lookup ([ec82bc1](https://github.com/Jaal-Yantra-Textiles/v2/commit/ec82bc18830bee0a61931f0b007ca26dd00f3a98))
* **workflows:** Verfication work ([7c8bf28](https://github.com/Jaal-Yantra-Textiles/v2/commit/7c8bf28843ffc60a2d6fa17c8423788c5a2d7411))
* **api:** Website .id ([cf025d8](https://github.com/Jaal-Yantra-Textiles/v2/commit/cf025d870680ba2217df5f3b1a8025c473f1f6cc))


### Features

* **api:** Added Discovery of the Product ([e6d961d](https://github.com/Jaal-Yantra-Textiles/v2/commit/e6d961d4b52abf532c38b29752a6c6f0d55fe42a))
* **api:** Admin creation support for the partners ([6f34555](https://github.com/Jaal-Yantra-Textiles/v2/commit/6f34555ecadca6faac85d2b318c8d20a689f0381))
* **api:** Auto-setup on store creation: ([78fc4f3](https://github.com/Jaal-Yantra-Textiles/v2/commit/78fc4f3666bbacf3f5efed21d0c1b309cea166d6))
* **api:** Backend (GET /store/partner-showcase): ([3304a18](https://github.com/Jaal-Yantra-Textiles/v2/commit/3304a18ed50b39f7e4d04e17880b5b2971c8301f))
* **partner:** move storefront details from metadata to table columns ([91e8acb](https://github.com/Jaal-Yantra-Textiles/v2/commit/91e8acb1dad5e4718e2d8905ccc0ef961d73e53e))
* **partner-ui:** move storefront editor to Partner UI as "Content" section ([4f79875](https://github.com/Jaal-Yantra-Textiles/v2/commit/4f798755520088834a0ede7d9014f0a407ed8cea))
* **api:** Partner can now create settings.theme ([9fd3727](https://github.com/Jaal-Yantra-Textiles/v2/commit/9fd3727079a86a34e2e290657d3c124e4a544889))
* **storefront:** partner storefront editor with visual page builder and live preview ([7ac9a10](https://github.com/Jaal-Yantra-Textiles/v2/commit/7ac9a1088dd05596c3acd1e8bea7939d865a4c8c))
* **workflows:** Payment provider payu is now supported ([0513e4a](https://github.com/Jaal-Yantra-Textiles/v2/commit/0513e4ab754e9f7e178c0dd53970f79147d14efe))
* **workflows:** Razorpay ([1b25bbc](https://github.com/Jaal-Yantra-Textiles/v2/commit/1b25bbc04976e4d53d11b50b47e890973ba66f31))
* **UI:** Skeleton Loading ([c0d637d](https://github.com/Jaal-Yantra-Textiles/v2/commit/c0d637d74868080e1f7e382b1a4e48adf9361640))
* **api:** Store channel scoping ([f40fd65](https://github.com/Jaal-Yantra-Textiles/v2/commit/f40fd65ad292b89d65f971fd1c78d9fc46fac3ac))
* theme editor in RouteFocusModal + fix storefront cache ([27536c3](https://github.com/Jaal-Yantra-Textiles/v2/commit/27536c39aa8201b5323bf362c8112530fde640cd))
* **partner-ui:** use RouteFocusModal for page editor overlay ([b39cf84](https://github.com/Jaal-Yantra-Textiles/v2/commit/b39cf842cf0b32564cb78a99605848c908f1c74e))
* **api:** Vercel domain ad ([4f48840](https://github.com/Jaal-Yantra-Textiles/v2/commit/4f48840e6cfaba3400c8fc1007378395571f1a1d))

## [10.12.3](https://github.com/Jaal-Yantra-Textiles/v2/compare/v10.12.2...v10.12.3) (2026-03-14)


### Bug Fixes

* **api:** Partner UI ([41234de](https://github.com/Jaal-Yantra-Textiles/v2/commit/41234de277d80d3ca00ba330ff75820b4b889e59))

## [10.12.2](https://github.com/Jaal-Yantra-Textiles/v2/compare/v10.12.1...v10.12.2) (2026-03-14)


### Bug Fixes

* **api:** Fixed the partner ui ([369b197](https://github.com/Jaal-Yantra-Textiles/v2/commit/369b197db1176be51a25327452f879fd053788df))

## [10.12.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v10.12.0...v10.12.1) (2026-03-14)


### Bug Fixes

* **api:** Fixes on the store front ([015cfca](https://github.com/Jaal-Yantra-Textiles/v2/commit/015cfcae805a649f9ccb97a1f5c841c3421f61be))
* **api:** Partner Service Worked out ([dd5e11e](https://github.com/Jaal-Yantra-Textiles/v2/commit/dd5e11e65cc43981be6e1ab2dde077c2dd45fd19))
* **api:** Partners ([3613db9](https://github.com/Jaal-Yantra-Textiles/v2/commit/3613db9767808c2e65581b3773b2c616d96808d3))
* **Partner UU:** The partner UI was manually creating FormData and calling sdk.client.fetch ([9f6255e](https://github.com/Jaal-Yantra-Textiles/v2/commit/9f6255e408eb1ab57901270ccad8ff13c065848d))

# [10.12.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v10.11.0...v10.12.0) (2026-03-14)


### Features

* **api:** Partners now scoped the customer ([d1848a7](https://github.com/Jaal-Yantra-Textiles/v2/commit/d1848a763f8d4ec4bfa6c409aff15c0ce6859ddb))

# [10.11.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v10.10.0...v10.11.0) (2026-03-14)


### Features

* **api:** store routes scope categories & collections via publishable key ([7ae85f9](https://github.com/Jaal-Yantra-Textiles/v2/commit/7ae85f933fc0631df75beb61c625b5d2941c9f20))

# [10.10.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v10.9.0...v10.10.0) (2026-03-14)


### Features

* **api:** Partner-scoped categories & collections via store links ([4b1bd81](https://github.com/Jaal-Yantra-Textiles/v2/commit/4b1bd8115a293f32d72ea87796d33e01c7217ea4))

# [10.9.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v10.8.3...v10.9.0) (2026-03-14)


### Bug Fixes

* **api:** Fixed the workflow type issues ([42658aa](https://github.com/Jaal-Yantra-Textiles/v2/commit/42658aa6312b742f14e1de7095b18326b8cc360f))
* **Vercel:** fixing the project name ([4adc722](https://github.com/Jaal-Yantra-Textiles/v2/commit/4adc7220cf7f89c431fdbb90ef15ab8dbef3532c))
* **Product:** Partners can now create a website at whim ([0910534](https://github.com/Jaal-Yantra-Textiles/v2/commit/09105343189b563c43e23aa18ce7f8490002b773))


### Features

* **api:** Partners now can create full fledged store ([73e721e](https://github.com/Jaal-Yantra-Textiles/v2/commit/73e721e196acbbfa468b8787f61d6072dc50034f))
* **api:** Partners now provision stores ([91770f1](https://github.com/Jaal-Yantra-Textiles/v2/commit/91770f164490e9ce31940046d2cd26d69b3122b8))

## [10.8.3](https://github.com/Jaal-Yantra-Textiles/v2/compare/v10.8.2...v10.8.3) (2026-03-13)


### Bug Fixes

* **Partners:** Fixed partner filters ([8877226](https://github.com/Jaal-Yantra-Textiles/v2/commit/8877226357d927e873724113746db3d8e5adaeba))

## [10.8.2](https://github.com/Jaal-Yantra-Textiles/v2/compare/v10.8.1...v10.8.2) (2026-03-13)


### Bug Fixes

* **workflows:** Dismiss all remote links before deleting a design ([8dc8aa5](https://github.com/Jaal-Yantra-Textiles/v2/commit/8dc8aa5d9a8351b3d8e57204383e60ef7f1f431a))
* **links:** Remove dead agreement links and restore feedback indexing ([9b046c9](https://github.com/Jaal-Yantra-Textiles/v2/commit/9b046c9a8c9037c93e9a9266ebcd68e16e09c94f))

## [10.8.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v10.8.0...v10.8.1) (2026-03-13)


### Bug Fixes

* **api:** Module links causing stress ([114e491](https://github.com/Jaal-Yantra-Textiles/v2/commit/114e4913e35c8ddb6f633d8c68469dc31aaea74b))

# [10.8.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v10.7.0...v10.8.0) (2026-03-13)


### Bug Fixes

* Node ENV setting unset ([7473b88](https://github.com/Jaal-Yantra-Textiles/v2/commit/7473b881fb3e3f88bfdf2ef1362d01cceab0be54))


### Features

* **api:** Store admin api inside the partner ([64e4e0a](https://github.com/Jaal-Yantra-Textiles/v2/commit/64e4e0ae03c3e96e194b7932ba1b400abfc312d2))

# [10.7.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v10.6.1...v10.7.0) (2026-03-13)


### Features

* **api:** Added a verification thing on the form for people to first verfiy and then send data ([8d22267](https://github.com/Jaal-Yantra-Textiles/v2/commit/8d22267cd1301ac966f9715c12b2ed78bdbb4645))

## [10.6.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v10.6.0...v10.6.1) (2026-03-13)


### Bug Fixes

* **api:** Fixed agreements related bugs ([37da9ce](https://github.com/Jaal-Yantra-Textiles/v2/commit/37da9cedfef4fd3a569fe8fbde5c14f044e810cd))
* **admin:** Fixed to use date picker and usePrompt ([00ead6c](https://github.com/Jaal-Yantra-Textiles/v2/commit/00ead6c310bb157099b58ed01bbbf33291124bff))

# [10.6.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v10.5.0...v10.6.0) (2026-03-12)


### Features

* **api:** design lifecycle ([b33f728](https://github.com/Jaal-Yantra-Textiles/v2/commit/b33f728def0de567ec53e0f2ff14e4f54e8db4d1))

# [10.5.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v10.4.1...v10.5.0) (2026-03-12)


### Bug Fixes

* **admin:** Fixed the @ direction ([21c78bb](https://github.com/Jaal-Yantra-Textiles/v2/commit/21c78bbe509235d0c5681e1b0b5514252985a499))


### Features

* **api:** Admin-User-Design Full Flow ([adefa3e](https://github.com/Jaal-Yantra-Textiles/v2/commit/adefa3e17cb7d7dacad61c6fe843ed7a4536a776))

## [10.4.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v10.4.0...v10.4.1) (2026-03-12)


### Bug Fixes

* **admin:** Fixed the layout of the reports ([08c40d1](https://github.com/Jaal-Yantra-Textiles/v2/commit/08c40d123a7935ec5d48653b7faea32cbb3942b4))

# [10.4.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v10.3.0...v10.4.0) (2026-03-11)


### Features

* **api:** Payment reporting system ([707e05f](https://github.com/Jaal-Yantra-Textiles/v2/commit/707e05fd9c2154a7c152faa29ad721d2fcf7e0a3))

# [10.3.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v10.2.3...v10.3.0) (2026-03-11)


### Features

* **api:** Price estimation API ([16e377e](https://github.com/Jaal-Yantra-Textiles/v2/commit/16e377eb2ec5f8fc56b3c02818e43db8dd4f926e))

## [10.2.3](https://github.com/Jaal-Yantra-Textiles/v2/compare/v10.2.2...v10.2.3) (2026-03-10)


### Bug Fixes

* **admin:** Design Component fix ([6123e68](https://github.com/Jaal-Yantra-Textiles/v2/commit/6123e68b8890ddebb03cf6b42abeee6cbb83a988))

## [10.2.2](https://github.com/Jaal-Yantra-Textiles/v2/compare/v10.2.1...v10.2.2) (2026-03-10)


### Bug Fixes

* **admin:** Fixed the design layout for the Meta Ads Tab ([e1419e1](https://github.com/Jaal-Yantra-Textiles/v2/commit/e1419e1ec025c16e976e99cc535340e6e0b94fc2))

## [10.2.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v10.2.0...v10.2.1) (2026-03-10)


### Bug Fixes

* **api:** design now be bundled ([9381583](https://github.com/Jaal-Yantra-Textiles/v2/commit/9381583d82013c0ac4b896ede4c2fa3fc9e2a2e6))

# [10.2.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v10.1.5...v10.2.0) (2026-03-10)


### Features

* **admin:** Changes in the meta ads ([fa79360](https://github.com/Jaal-Yantra-Textiles/v2/commit/fa793608bf4a932baf5bd7ca2f88c21c7b0c03b6))

## [10.1.5](https://github.com/Jaal-Yantra-Textiles/v2/compare/v10.1.4...v10.1.5) (2026-03-10)


### Bug Fixes

* **admin:** Fixing the send loading on the command bar ([892aaf7](https://github.com/Jaal-Yantra-Textiles/v2/commit/892aaf710bebd3eef62111d913b2b36618c042a2))
* **api:** Partner being sent ([0f30178](https://github.com/Jaal-Yantra-Textiles/v2/commit/0f3017826b65d486ba81b8fb76d440bc77c59410))

## [10.1.4](https://github.com/Jaal-Yantra-Textiles/v2/compare/v10.1.3...v10.1.4) (2026-03-09)


### Bug Fixes

* **admin:** Media listing from the design ([055dd56](https://github.com/Jaal-Yantra-Textiles/v2/commit/055dd56ef146767842ebfaf85011c16dd55112e2))

## [10.1.3](https://github.com/Jaal-Yantra-Textiles/v2/compare/v10.1.2...v10.1.3) (2026-03-09)


### Bug Fixes

* **admin:** QR GEN ([b637e36](https://github.com/Jaal-Yantra-Textiles/v2/commit/b637e36edd8bada017cc48d8f5a1650488b93e39))

## [10.1.2](https://github.com/Jaal-Yantra-Textiles/v2/compare/v10.1.1...v10.1.2) (2026-03-09)


### Bug Fixes

* **admin:** QR fixer ([7a36d05](https://github.com/Jaal-Yantra-Textiles/v2/commit/7a36d05be1872a3e86e65bf938aaa7cebf2cd37c))
* **api:** Search for designs ([8484a5f](https://github.com/Jaal-Yantra-Textiles/v2/commit/8484a5f5d82c12a39a4e24c15648865af44b050d))

## [10.1.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v10.1.0...v10.1.1) (2026-03-09)


### Bug Fixes

* **Index:** removing it for now ([4fdfd69](https://github.com/Jaal-Yantra-Textiles/v2/commit/4fdfd6992e481cedc737beebcfe392020a01575b))

# [10.1.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v10.0.1...v10.1.0) (2026-03-09)


### Features

* **admin:** Currency default converter ([aa822b6](https://github.com/Jaal-Yantra-Textiles/v2/commit/aa822b6b65d9ace36bc4287059c86b0b02a9f07c))

## [10.0.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v10.0.0...v10.0.1) (2026-03-09)


### Bug Fixes

* **admin:** Fixed the admin layouts ([5d5e128](https://github.com/Jaal-Yantra-Textiles/v2/commit/5d5e128f0147845739adbb7ea6f0da3a0d0b72b5))
* **admin:** Qr code fixer ([0f02d1d](https://github.com/Jaal-Yantra-Textiles/v2/commit/0f02d1d7eaf18ba0b1b2cb88af6b00cd78cff150))

# [10.0.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v9.10.0...v10.0.0) (2026-03-08)


### Bug Fixes

* **CI:** Fixed the CI healthcheck ([fa74193](https://github.com/Jaal-Yantra-Textiles/v2/commit/fa7419343d32cbeb5792bb0e2cf1de36c88e7f46))
* **admin:** Fixed the design creation from the media toggle ([655fc0c](https://github.com/Jaal-Yantra-Textiles/v2/commit/655fc0c251ba83d99f6f93c43175b1889d51361a))
* **api:** Media Product ([7dfdbe3](https://github.com/Jaal-Yantra-Textiles/v2/commit/7dfdbe3bbaf1f4c985cc4becfe10f699e4861b36))
* sync pnpm-lock.yaml with qs ^6.14.2 in partner-ui ([f5d9f99](https://github.com/Jaal-Yantra-Textiles/v2/commit/f5d9f99ca6ae792f74faebc9d9cdee0c48115c79))


### Features

* **admin:** Fixed product creation ([070fbb5](https://github.com/Jaal-Yantra-Textiles/v2/commit/070fbb591c1de75b49cc6b2563433c67d4b5c149))


### BREAKING CHANGES

* **admin:**

# [9.10.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v9.9.0...v9.10.0) (2026-03-08)


### Bug Fixes

* **docs:** Docs fix ([aefcd37](https://github.com/Jaal-Yantra-Textiles/v2/commit/aefcd373af0867ab934bc501707f05496fb4de77))
* **api:** Fixed some build errors ([8cff26e](https://github.com/Jaal-Yantra-Textiles/v2/commit/8cff26e7f54aa8f4da0ee1302ea7a8ace62e4990))


### Features

* **api:** Ad Planning ([ceb4a1e](https://github.com/Jaal-Yantra-Textiles/v2/commit/ceb4a1eef665e3fa462b26d9034472a81c01fe3d))
* **api:** Product can be created from the Media now ([c08249e](https://github.com/Jaal-Yantra-Textiles/v2/commit/c08249ec1d25beeb87d43ea4a26192b3f0d7304d))
* **api:** Product Creation from Design ([a9de071](https://github.com/Jaal-Yantra-Textiles/v2/commit/a9de071dd2470e95a59f5b5cb7491c7d32722e00))

# [9.9.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v9.8.0...v9.9.0) (2026-03-07)


### Features

* **api:** AI try on ([387ef22](https://github.com/Jaal-Yantra-Textiles/v2/commit/387ef2203a1650487ac32e5590485db0a3849149))

# [9.8.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v9.7.0...v9.8.0) (2026-03-07)


### Features

* add PUT /store/custom/designs/:id for customer design updates ([974d9bd](https://github.com/Jaal-Yantra-Textiles/v2/commit/974d9bdaeeb0c60b4f3f9ac05613f97437a38322))

# [9.7.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v9.6.0...v9.7.0) (2026-03-06)


### Bug Fixes

* increase body size limit to 5MB for design create route ([2cc4792](https://github.com/Jaal-Yantra-Textiles/v2/commit/2cc4792acac95726480b238100c0164dd31ca35e))


### Features

* switch file provider from file-local to file-s3 ([1094405](https://github.com/Jaal-Yantra-Textiles/v2/commit/109440539d800f6bd526388cafb6f97fecdf6a38))

# [9.6.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v9.5.0...v9.6.0) (2026-03-06)


### Bug Fixes

* **api:** env var ([ca77c5d](https://github.com/Jaal-Yantra-Textiles/v2/commit/ca77c5d38bff3b9900a5f16152cda0ea0e6b3dae))
* **api:** Fashion Lib moodboard ([a3a6962](https://github.com/Jaal-Yantra-Textiles/v2/commit/a3a69623708b6bad25a1c05312c992a497abc20a))
* **admin:** Fixed social media upload for video support ([0cdf193](https://github.com/Jaal-Yantra-Textiles/v2/commit/0cdf193f8cb8ea6ff929662b8c2375c08a234636))


### Features

* add store-level presigned upload endpoint for design layer images ([9e96492](https://github.com/Jaal-Yantra-Textiles/v2/commit/9e96492302609b143666bd44e2e28c7f2787a5ba))
* **api:** Analytics and QR Generator ([883f727](https://github.com/Jaal-Yantra-Textiles/v2/commit/883f727a79eb57771e40b6432e396c3d1a5b06a4))

# [9.5.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v9.4.1...v9.5.0) (2026-03-06)


### Features

* **admin:** Hang Tags QR Gen ([f43878c](https://github.com/Jaal-Yantra-Textiles/v2/commit/f43878c26cb8805746ca58060990a10f2bcca6ae))

## [9.4.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v9.4.0...v9.4.1) (2026-03-05)


### Bug Fixes

* **api:** Visual Flow ([aec10bf](https://github.com/Jaal-Yantra-Textiles/v2/commit/aec10bf4d82135a7d229dafd384feb4ab32e0fa5))

# [9.4.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v9.3.2...v9.4.0) (2026-03-05)


### Bug Fixes

* **Mastra:** Model rotator ([6f7bd32](https://github.com/Jaal-Yantra-Textiles/v2/commit/6f7bd3255f463c5c54b3e3f88498e85370859f99))
* **api:** Try on stuff with the working api ([297ab96](https://github.com/Jaal-Yantra-Textiles/v2/commit/297ab968c1b75a5b6f89ef6595bec4923cf5d368))


### Features

* **Models:** rotators are now working ([04aebaa](https://github.com/Jaal-Yantra-Textiles/v2/commit/04aebaa0478861753b794de6434ef114f7fc5256))


### Reverts

* **CI:** Some work was added which was not intentional ([c47060e](https://github.com/Jaal-Yantra-Textiles/v2/commit/c47060e9824c219aba734b35fb5514a2fbcc66d2))

## [9.3.2](https://github.com/Jaal-Yantra-Textiles/v2/compare/v9.3.1...v9.3.2) (2026-03-04)


### Bug Fixes

* **api:** Client-controlled MIME type forwarded to fal.ai ([ac386e8](https://github.com/Jaal-Yantra-Textiles/v2/commit/ac386e8fa26499cb7a451cf61292efaf77e8189a))
* **CI:** ds store ([adf157d](https://github.com/Jaal-Yantra-Textiles/v2/commit/adf157d80249cdd19341279d06abc064dbed92ad))
* **admin:** Fixed the UI visual flow settings editor ([393d138](https://github.com/Jaal-Yantra-Textiles/v2/commit/393d138970e36ba4b50ea8f7bec0360eb77c4f4e))
* **api:** fixing the try on api 2 file ([fef481d](https://github.com/Jaal-Yantra-Textiles/v2/commit/fef481d0e6918f71ed4d27566b1f8159beb23ee0))
* **admin:** flow-editor.tsx ([c2fd3e6](https://github.com/Jaal-Yantra-Textiles/v2/commit/c2fd3e6d5c84a4ce8b2d0a34be16f39fd7c8d3ec))
* **api:** Garment → stage.toBlob() (raw binary Blob) + face → File (already binary) → both sent as ([2214afd](https://github.com/Jaal-Yantra-Textiles/v2/commit/2214afd89dee891c43a63d60da08c33b4e3047ca))

## [9.3.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v9.3.0...v9.3.1) (2026-03-04)


### Bug Fixes

* **workflows:** Fixed the inventory order workflow ([fd9629f](https://github.com/Jaal-Yantra-Textiles/v2/commit/fd9629ff4fa93e78ebbd937265945ff447874f1a))

# [9.3.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v9.2.0...v9.3.0) (2026-03-04)


### Bug Fixes

* **api:** inbound-mails ([807b90b](https://github.com/Jaal-Yantra-Textiles/v2/commit/807b90b50b0319c4185a9053594af4053f68e10f))


### Features

* **api:** inbound-emails ([2add2a0](https://github.com/Jaal-Yantra-Textiles/v2/commit/2add2a0242d97db79856d4de82268c89e0e71405))

# [9.2.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v9.1.1...v9.2.0) (2026-03-04)


### Bug Fixes

* **api:** Try on stuff with the working api ([5de1119](https://github.com/Jaal-Yantra-Textiles/v2/commit/5de1119bdddca47fa9603bc8084f6e717f68b26b))


### Features

* **AI:** trying on API's ([d0600d3](https://github.com/Jaal-Yantra-Textiles/v2/commit/d0600d3603d3d444476e99e9dae5fb3e1b475f5b))


### Reverts

* **CI:** Some work was added which was not intentional ([edfa0b3](https://github.com/Jaal-Yantra-Textiles/v2/commit/edfa0b34bda081b14c752a702d12838984b55920))

## [9.1.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v9.1.0...v9.1.1) (2026-03-03)


### Bug Fixes

* **api:** fixing the module resolution error at the build ([94f487d](https://github.com/Jaal-Yantra-Textiles/v2/commit/94f487dca15cc2cc813bc515fc8c6e7b047eb068))
* **api:** Workflows with Inbound Mail settings where we can recieve external orders that we place for the inventory and inbventory will be created automagically ([ac51746](https://github.com/Jaal-Yantra-Textiles/v2/commit/ac51746a855f5518ecbb7870165892fd10b2ec40))

# [9.1.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v9.0.0...v9.1.0) (2026-03-01)


### Bug Fixes

* **workflows:** Fixed workflow run type script inference ([c734611](https://github.com/Jaal-Yantra-Textiles/v2/commit/c734611a4efaf2def2fd085fdc3a529d05b34655))


### Features

* **api:** Visual editor inside the web view ([268a5f3](https://github.com/Jaal-Yantra-Textiles/v2/commit/268a5f36e105c5c95a2dbf2059d0b04e86091296))

# [9.0.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v8.16.1...v9.0.0) (2026-03-01)


### Bug Fixes

* **partner-ui:** Date filter in the inventory ficed ([0d49a5c](https://github.com/Jaal-Yantra-Textiles/v2/commit/0d49a5c8a9b182018ddd6ed6b5feefe12ad68949))
* **partner-ui:** DateFilter ([cb22caa](https://github.com/Jaal-Yantra-Textiles/v2/commit/cb22caaa3af7b08bde2fe9e141681956b2c98ae2))
* **docs:** Fixed the loading of the payment methods. ([12514e9](https://github.com/Jaal-Yantra-Textiles/v2/commit/12514e95993a2634640bd287e657b81e5c8848ef))
* **api:** Fixed the logic for the invo logic ([c4faaac](https://github.com/Jaal-Yantra-Textiles/v2/commit/c4faaac94dfe9ff6f16f24fb5bafd2b31451c06d))
* **workflows:** fixed the service tye ([6221256](https://github.com/Jaal-Yantra-Textiles/v2/commit/622125661135f424d7f6fb941c2318bf8ede9eca))
* **workflows:** Fixed the type issue ([dcee2af](https://github.com/Jaal-Yantra-Textiles/v2/commit/dcee2afc211b356f2b4d9797b5f77925f88c99ae))
* **scripts:** fixed yarn to pnpm ([94f7075](https://github.com/Jaal-Yantra-Textiles/v2/commit/94f7075bf2486f1e2853240f33510c72df23ac2a))
* **invo:** Inventory order line logic fixed ([6b1c4ad](https://github.com/Jaal-Yantra-Textiles/v2/commit/6b1c4ad753810edd8d10a6ce0e8163f2e3a9571a))


### Code Refactoring

* **api:** yarn --> to pnpm to smoothen some stuff out ([35dfd17](https://github.com/Jaal-Yantra-Textiles/v2/commit/35dfd173a91db59195d9f6710fdf0a0b52cec0be))


### Features

* **api:** Payment intent at the inventory order ([35b354b](https://github.com/Jaal-Yantra-Textiles/v2/commit/35b354be956892e253a5cfa6eedd2071cc2d4cdb))
* **api:** Raw material SKU label generation ([9a04723](https://github.com/Jaal-Yantra-Textiles/v2/commit/9a04723e45f6870a846d1e45862751fbc0def0c8))


### BREAKING CHANGES

* **api:** 
* **api:**

## [8.16.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v8.16.0...v8.16.1) (2026-02-08)


### Bug Fixes

* **build:** ci build error fix ([8e3ca1d](https://github.com/Jaal-Yantra-Textiles/v2/commit/8e3ca1d2c10cf4a0ef6a1f2754f08737120e7ebb))
* **Build:** module enot registered ([8bf44fa](https://github.com/Jaal-Yantra-Textiles/v2/commit/8bf44fabc9cf0b12960d81bf0d25b2fc8b4c1436))

# [8.16.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v8.15.0...v8.16.0) (2026-02-07)


### Features

* **admin:** Docs for better clarity and users ([ea03209](https://github.com/Jaal-Yantra-Textiles/v2/commit/ea03209158e9801fbf99246e0060e42488a666ba))

# [8.15.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v8.14.1...v8.15.0) (2026-02-07)


### Bug Fixes

* **scripts:** Build fixes and other scripts related fixes ([cc1736d](https://github.com/Jaal-Yantra-Textiles/v2/commit/cc1736db7dcff9de23e4f82e6dc995901f71a686))


### Features

* consolidate AI chat, add spec DB storage, ad-planning, and platform features ([92bc280](https://github.com/Jaal-Yantra-Textiles/v2/commit/92bc280bbfef1480ea1e24b4db134bb453d20048))
* **api:** Header with "Ad Planning & Attribution" title ([30e6044](https://github.com/Jaal-Yantra-Textiles/v2/commit/30e60447ed61ed651b0bc664a82a492a9c722a29))

## [8.14.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v8.14.0...v8.14.1) (2026-01-09)


### Bug Fixes

* **docs:** Design customer link ([1a3a812](https://github.com/Jaal-Yantra-Textiles/v2/commit/1a3a812bdd225dba4b85574ab9dd93a75adc6351))

# [8.14.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v8.13.0...v8.14.0) (2026-01-09)


### Features

* **api:** Design to cart API ([833affe](https://github.com/Jaal-Yantra-Textiles/v2/commit/833affe0a01c1853f080fc4bf769cf1c9ca8a134))

# [8.13.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v8.12.1...v8.13.0) (2026-01-09)


### Features

* **api:** AI Image gen ([61b0c42](https://github.com/Jaal-Yantra-Textiles/v2/commit/61b0c42901c07d27fa75662d3f2e7f14676ae7e6))

## [8.12.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v8.12.0...v8.12.1) (2026-01-08)


### Bug Fixes

* **workflows:** Image Gen workflows using Mistral AI ([a88b2bc](https://github.com/Jaal-Yantra-Textiles/v2/commit/a88b2bcd99247f6757d8e6a78bd6bf466bfbbe87))

# [8.12.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v8.11.0...v8.12.0) (2026-01-07)


### Bug Fixes

* **Package:** fixed the aisdk package ([8ade5be](https://github.com/Jaal-Yantra-Textiles/v2/commit/8ade5be1700ff96ba3bcace015f9e3038d23ccc8))


### Features

* **api:** Image Gen API ([17313d6](https://github.com/Jaal-Yantra-Textiles/v2/commit/17313d6216cb7c1fb60b96a16ff43ff1c3270e75))

# [8.11.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v8.10.2...v8.11.0) (2026-01-06)


### Features

* **api:** UI Custom Filter View for ease ([a299769](https://github.com/Jaal-Yantra-Textiles/v2/commit/a299769c4a1eeb35a91318e2c9c2be3133a6d54f))

## [8.10.2](https://github.com/Jaal-Yantra-Textiles/v2/compare/v8.10.1...v8.10.2) (2026-01-04)


### Bug Fixes

* **admin:** Geocoding address null summary issue ([ec6c292](https://github.com/Jaal-Yantra-Textiles/v2/commit/ec6c292d9313d4333afab35beb5833a68d7a7216))

## [8.10.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v8.10.0...v8.10.1) (2026-01-04)

# [8.10.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v8.9.0...v8.10.0) (2026-01-04)


### Features

* **admin:** Production Runs ([554cbeb](https://github.com/Jaal-Yantra-Textiles/v2/commit/554cbeb2815155bc31aa6c0404927d7e65dc7744))

# [8.9.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v8.8.0...v8.9.0) (2026-01-04)


### Features

* **api:** Production runs and Mobile App for the storefront ([3353486](https://github.com/Jaal-Yantra-Textiles/v2/commit/3353486faeb23f252c5349e23f94544663d3146e))

# [8.8.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v8.7.0...v8.8.0) (2026-01-02)


### Features

* **api:** Forms recording on various parts of commerce is now supported ([b92d878](https://github.com/Jaal-Yantra-Textiles/v2/commit/b92d87808d6066c867372d8dc144b004f8e3cb86))

# [8.7.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v8.6.2...v8.7.0) (2026-01-01)


### Bug Fixes

* **admin:** Meta ads with toast ([1431bb5](https://github.com/Jaal-Yantra-Textiles/v2/commit/1431bb5fa492e63e627169aa347f9138e28cde50))
* **api:** Social service type fix ([e006c44](https://github.com/Jaal-Yantra-Textiles/v2/commit/e006c44b724879225b3bb01eb43d4f5e9be20e92))


### Features

* **api:** Meta ads insight depth level supported to store in the DB ([725fce9](https://github.com/Jaal-Yantra-Textiles/v2/commit/725fce9ccda31ca876d59499395b7b31cd8db6dc))

## [8.6.2](https://github.com/Jaal-Yantra-Textiles/v2/compare/v8.6.1...v8.6.2) (2026-01-01)


### Bug Fixes

* **api:** Seed email templates, and the middleware.ts for the validators inside the partners API ([1e10118](https://github.com/Jaal-Yantra-Textiles/v2/commit/1e10118a9c12328dd7fe202f07d2d8f850b3ca85))

## [8.6.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v8.6.0...v8.6.1) (2025-12-31)


### Bug Fixes

* **admin:** Fixed the admin to send retry with updated information or data ([b78b5a0](https://github.com/Jaal-Yantra-Textiles/v2/commit/b78b5a0e015657e423ff337c5bf1fdae98e5fa3a))

# [8.6.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v8.5.1...v8.6.0) (2025-12-31)


### Bug Fixes

* **api:** Notification retry method now avaialble with the feed ([2529c7f](https://github.com/Jaal-Yantra-Textiles/v2/commit/2529c7f03114aae05771416acbaf8d02b1cc8bf7))
* **admin:** Sending notification with retry feed fix ([d6a33e8](https://github.com/Jaal-Yantra-Textiles/v2/commit/d6a33e80392f6464f0fa58b6013802e2bf9aa7d6))


### Features

* **api:** Adming notifications to search the email failed options to be retried ([a9684c0](https://github.com/Jaal-Yantra-Textiles/v2/commit/a9684c01deb89b424c397c9cb5344db7acfdcebf))

## [8.5.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v8.5.0...v8.5.1) (2025-12-30)

# [8.5.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v8.4.2...v8.5.0) (2025-12-27)


### Features

* **api:** Admin API for the persons making dynamic calls to the resources registry ([cbb54e9](https://github.com/Jaal-Yantra-Textiles/v2/commit/cbb54e94544bfd1e5f887c54968f8c0a546b2094))

## [8.4.2](https://github.com/Jaal-Yantra-Textiles/v2/compare/v8.4.1...v8.4.2) (2025-12-26)


### Bug Fixes

* **workflows:** The notification payload now includes the normalized tracking_numbers/tracking_links, Handlebars pre-rendered HTML with the helpers (dates, money, etc.), and all the shipment/order context we expect. ([3ce1767](https://github.com/Jaal-Yantra-Textiles/v2/commit/3ce1767363408c4831cb528e74caa4a64a6aca1b))

## [8.4.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v8.4.0...v8.4.1) (2025-12-25)


### Bug Fixes

* **admin:** Implemented blob-based downloading in apps/media-gallery/index.html, so “Download All” and per-item downloads fetch each file ([cc51009](https://github.com/Jaal-Yantra-Textiles/v2/commit/cc51009d0e1d5e5f3ba777871f642ad8ecd186e5))

# [8.4.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v8.3.0...v8.4.0) (2025-12-21)


### Bug Fixes

* **Media Gallery:** Fixed media download support ([73a741b](https://github.com/Jaal-Yantra-Textiles/v2/commit/73a741be815b700c48e2b4412b1551d3e2e5bacd))
* **Media Gallery:** Fixed meta tags ([9f75b53](https://github.com/Jaal-Yantra-Textiles/v2/commit/9f75b538aa3a7de1447b6358cc8fab71cc3ef105))
* **admin:** Fixed the copy URL path ([3be4d46](https://github.com/Jaal-Yantra-Textiles/v2/commit/3be4d46f3bd635794b90fdcb15c594c352d8cbe0))
* **Media Gallery:** Fixed the env var ([7acba66](https://github.com/Jaal-Yantra-Textiles/v2/commit/7acba66cdab37aaf55e9fac882c1603a3f754cd6))
* **Media Gallery:** Fixed the mov support ([95133bd](https://github.com/Jaal-Yantra-Textiles/v2/commit/95133bdc34e51122e0da12c9cc1e0999ad549c84))


### Features

* **api:** Media gallery on public support ([dccad45](https://github.com/Jaal-Yantra-Textiles/v2/commit/dccad45a5ac59d0db7c51b491fafe10cc70babb3))

# [8.3.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v8.2.3...v8.3.0) (2025-12-21)


### Features

* **admin:** Product views on the UI ([18ffd9d](https://github.com/Jaal-Yantra-Textiles/v2/commit/18ffd9dee024c0a7038959fd3e9e232a833d95d1))

## [8.2.3](https://github.com/Jaal-Yantra-Textiles/v2/compare/v8.2.2...v8.2.3) (2025-12-21)

## [8.2.2](https://github.com/Jaal-Yantra-Textiles/v2/compare/v8.2.1...v8.2.2) (2025-12-20)


### Bug Fixes

* **admin:** Fixed the ai v2 dictionary ([957bf5d](https://github.com/Jaal-Yantra-Textiles/v2/commit/957bf5d35502bf5cb84618c6d529dee528273c99))

## [8.2.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v8.2.0...v8.2.1) (2025-12-20)


### Bug Fixes

* **admin:** The module resolver error fixed ([a79fd99](https://github.com/Jaal-Yantra-Textiles/v2/commit/a79fd990c03ba4522c288de0d71764df407a7319))

# [8.2.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v8.1.0...v8.2.0) (2025-12-20)


### Features

* **api:** Ai v2 ([533f65d](https://github.com/Jaal-Yantra-Textiles/v2/commit/533f65da64c8df78de062c5fa7bee3386973adc4))

# [8.1.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v8.0.2...v8.1.0) (2025-12-16)


### Features

* **api:** AI general chat UI and API fix ([930a530](https://github.com/Jaal-Yantra-Textiles/v2/commit/930a53048f9f6536ffe3aa34ea7bcac7e9916463))

## [8.0.2](https://github.com/Jaal-Yantra-Textiles/v2/compare/v8.0.1...v8.0.2) (2025-12-16)


### Bug Fixes

* **admin:** Code editor modal fix ([f13df56](https://github.com/Jaal-Yantra-Textiles/v2/commit/f13df5602a9cbb14736b754f72b539793fc704c4))
* **api:** Mastra agent lib update ([0413706](https://github.com/Jaal-Yantra-Textiles/v2/commit/041370618a1184b0fb7d1d162349c9eddabefee5))

## [8.0.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v8.0.0...v8.0.1) (2025-12-16)

# [8.0.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v7.3.6...v8.0.0) (2025-12-15)


### Bug Fixes

* **api:** Code exection with NPM packages ([30d56fb](https://github.com/Jaal-Yantra-Textiles/v2/commit/30d56fbdac98722a6de863a0ddd1ad9e31d23c8a))
* **api:** Comments api now shows 404 instead of 403 ([21f6f10](https://github.com/Jaal-Yantra-Textiles/v2/commit/21f6f10acfbb213f2f39c26d673edd32db450c82))
* **api:** Fixed password update ([abb8e1e](https://github.com/Jaal-Yantra-Textiles/v2/commit/abb8e1e8387e2b0d30ff285bfa7c0c6e73fe1917))
* **admin:** Fixed the inventory line to show title ([ae3d3ba](https://github.com/Jaal-Yantra-Textiles/v2/commit/ae3d3ba8fd25f968de1dda50902c9eed06dff77a))
* **api:** Fixed the issue at the testing ([04853e3](https://github.com/Jaal-Yantra-Textiles/v2/commit/04853e31088a0a423b74e46538e23f9c999ccbf1))
* **api:** Fixed the route settings api and build issue ([1378607](https://github.com/Jaal-Yantra-Textiles/v2/commit/137860777231a8aac30c8e837ebcfe609d64c6c3))
* **api:** Removed fallback + legacy helpers from the partners api ([d88d82b](https://github.com/Jaal-Yantra-Textiles/v2/commit/d88d82bec1ecbf7d2338e17310146efafe925d53))
* **api:** Routine code change ([020be62](https://github.com/Jaal-Yantra-Textiles/v2/commit/020be628e8799473fb8417c1ac3d794da8335285))
* **api:** visual flow and media route ([0066ca0](https://github.com/Jaal-Yantra-Textiles/v2/commit/0066ca0bbbe36d0ba19b06e4aa861771e6f06f09))


### Code Refactoring

* **admin:** Fixed the material item modal ([29e8eb2](https://github.com/Jaal-Yantra-Textiles/v2/commit/29e8eb24da7618a373999986231451d55556b753))


### Features

* **api:** Metadata fix returning appropriate entities ([f5bff14](https://github.com/Jaal-Yantra-Textiles/v2/commit/f5bff149b5deedcd9806cd760d4c84240cbb5b1e))
* **PartnerUI:** new partner UI as apps ([37e6bb9](https://github.com/Jaal-Yantra-Textiles/v2/commit/37e6bb9257848bdb1bee045d691c7848f0e96456))
* **api:** Partner Ui as apps ([962ff44](https://github.com/Jaal-Yantra-Textiles/v2/commit/962ff441b7e60e1df06fd92a78982bee331035b8))


### BREAKING CHANGES

* **admin:**

## [7.3.6](https://github.com/Jaal-Yantra-Textiles/v2/compare/v7.3.5...v7.3.6) (2025-12-10)


### Bug Fixes

* **api:** Fixed operations db issues with HTTP req and code editor ([0793223](https://github.com/Jaal-Yantra-Textiles/v2/commit/07932232f332bc09f74ec59633fcbdb3e62f5f9d))

## [7.3.5](https://github.com/Jaal-Yantra-Textiles/v2/compare/v7.3.4...v7.3.5) (2025-12-09)

## [7.3.4](https://github.com/Jaal-Yantra-Textiles/v2/compare/v7.3.3...v7.3.4) (2025-12-09)


### Bug Fixes

* **api:** add execute_code and trigger flow to operation type in DB ([a629a9b](https://github.com/Jaal-Yantra-Textiles/v2/commit/a629a9bb942f379d82d563a8b9129fa43a8b8628))

## [7.3.3](https://github.com/Jaal-Yantra-Textiles/v2/compare/v7.3.2...v7.3.3) (2025-12-09)


### Bug Fixes

* **Module:** Fixed module resolution in the prod ([4b0a1e9](https://github.com/Jaal-Yantra-Textiles/v2/commit/4b0a1e9359a41a9535064af8cf4fdd059ffe9793))

## [7.3.2](https://github.com/Jaal-Yantra-Textiles/v2/compare/v7.3.1...v7.3.2) (2025-12-09)


### Bug Fixes

* **api:** Visual flow config and file path change ([4e91071](https://github.com/Jaal-Yantra-Textiles/v2/commit/4e910712c71239cb51542c5066229ac0c8940796))

## [7.3.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v7.3.0...v7.3.1) (2025-12-08)

# [7.3.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v7.2.1...v7.3.0) (2025-12-08)


### Features

* **admin:** Fixed the admin layout of visual flow builder ([dfab2f8](https://github.com/Jaal-Yantra-Textiles/v2/commit/dfab2f840a81996f33ca6c618eb30cd9c628061a))
* **api:** Visual Flow Builder ([383549d](https://github.com/Jaal-Yantra-Textiles/v2/commit/383549d8b9a8a90e6b995585299debcc3c287c84))

## [7.2.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v7.2.0...v7.2.1) (2025-12-07)


### Bug Fixes

* **workflows:** Refresh Token Better handling ([fd0050f](https://github.com/Jaal-Yantra-Textiles/v2/commit/fd0050f9f89cfe8a4bf006713c7c36eb48ca3198))

# [7.2.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v7.1.0...v7.2.0) (2025-12-07)


### Features

* **api:** Fixed the meta ads API ([3efd926](https://github.com/Jaal-Yantra-Textiles/v2/commit/3efd926d75ee62cd0f8157d42ae7092f2bbb1ae0))

# [7.1.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v7.0.0...v7.1.0) (2025-12-07)


### Features

* **api:** Meta Ads Sync in Dashboard ([f6c2a63](https://github.com/Jaal-Yantra-Textiles/v2/commit/f6c2a63d32ac37c7a49ed290c592819fa5c20008))

# [7.0.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.39.4...v7.0.0) (2025-12-07)


### Features

* **api:** Social meta leads now enabled for ads tracking ([bded6c4](https://github.com/Jaal-Yantra-Textiles/v2/commit/bded6c41055f12c01211c643059b6a65757fd809))


### BREAKING CHANGES

* **api:**

## [6.39.4](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.39.3...v6.39.4) (2025-12-06)


### Bug Fixes

* **api:** refresh token mismatch hit sequence fixed ([32cf24b](https://github.com/Jaal-Yantra-Textiles/v2/commit/32cf24b3db97f5f9006d7ddf2aa1c4f3bc4b84b8))

## [6.39.3](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.39.2...v6.39.3) (2025-12-06)


### Bug Fixes

* **workflows:** X publishing success ([1aa28a7](https://github.com/Jaal-Yantra-Textiles/v2/commit/1aa28a7c197ef6910788704dcaae1b718d99085e))

## [6.39.2](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.39.1...v6.39.2) (2025-12-06)


### Bug Fixes

* **api:** Fixed the publish item failing because of pageID ([4fee8f9](https://github.com/Jaal-Yantra-Textiles/v2/commit/4fee8f9433b79b8a9802ee25a00301f53d9c7732))

## [6.39.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.39.0...v6.39.1) (2025-12-06)


### Bug Fixes

* **api:** Social Post sync insights ([f8fa41e](https://github.com/Jaal-Yantra-Textiles/v2/commit/f8fa41e8e0a082ffb309767f7482680f930f02ca))

# [6.39.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.38.4...v6.39.0) (2025-12-06)


### Features

* **api:** Publishing social post with configuration ([187f9fa](https://github.com/Jaal-Yantra-Textiles/v2/commit/187f9fab1510099ff59c39148176625e6a68e3d2))

## [6.38.4](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.38.3...v6.38.4) (2025-12-06)


### Bug Fixes

* **workflows:** Direct smart retry and tweet , etsy exchange oauth ([c722a74](https://github.com/Jaal-Yantra-Textiles/v2/commit/c722a74266dbac33ff195364404d80667ddac199))
* **social:** Fixed instgram delay ([a78df83](https://github.com/Jaal-Yantra-Textiles/v2/commit/a78df83b6cbdc6fb5be0601a348f04b15090a2c9))
* **admin:** Social sync insights ([faf231d](https://github.com/Jaal-Yantra-Textiles/v2/commit/faf231dc6c193290f4871c759a3e7c31262f8dc3))

## [6.38.3](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.38.2...v6.38.3) (2025-12-04)


### Bug Fixes

* **Mastra:** fixed the mastra product description image retreival ([0d68437](https://github.com/Jaal-Yantra-Textiles/v2/commit/0d68437d9642b9cae9aff22e47c86a00b08b03dc))

## [6.38.2](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.38.1...v6.38.2) (2025-12-04)


### Bug Fixes

* **admin:** Fixed the people filtering search inside the product ([ee7b663](https://github.com/Jaal-Yantra-Textiles/v2/commit/ee7b663c69632991167c525f3ddd6d8b078520b8))

## [6.38.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.38.0...v6.38.1) (2025-12-04)

# [6.38.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.37.0...v6.38.0) (2025-12-04)


### Features

* **api:** Fixed the image loading to load memory responsive images ([edb0730](https://github.com/Jaal-Yantra-Textiles/v2/commit/edb0730597da4c58c37f296a6d40c4407cd3f751))

# [6.37.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.36.0...v6.37.0) (2025-12-03)


### Features

* **api:** Design page api fix and new feature ([cf0da19](https://github.com/Jaal-Yantra-Textiles/v2/commit/cf0da1997604a8a08682b0f0d159993069a5691b))

# [6.36.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.35.1...v6.36.0) (2025-12-03)


### Bug Fixes

* **admin:** Fixed the admin oauth return url in the UI ([628434f](https://github.com/Jaal-Yantra-Textiles/v2/commit/628434fc646fc2eb2b842b7a4894a56e344ee7ee))


### Features

* **api:** Raw materials api exposing data to stores ([da0d4b5](https://github.com/Jaal-Yantra-Textiles/v2/commit/da0d4b5027e04d9fb5efa9d09cd0c99913a8f878))

## [6.35.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.35.0...v6.35.1) (2025-11-28)


### Bug Fixes

* **api and UI:** Partner and UI fix ([9e73da8](https://github.com/Jaal-Yantra-Textiles/v2/commit/9e73da87d2c6e4595c129719f51eca9205c78a72))

# [6.35.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.34.0...v6.35.0) (2025-11-28)


### Features

* **api:** Social platform api overhaul ([924347b](https://github.com/Jaal-Yantra-Textiles/v2/commit/924347bff901d7c407cd063ab1161c9b1a1f7841))
* **api:** Social publishing and partner api fix ([8b3256c](https://github.com/Jaal-Yantra-Textiles/v2/commit/8b3256c2594492199bd856ef80637a0259db20b0))

# [6.34.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.33.2...v6.34.0) (2025-11-18)


### Bug Fixes

* **admin:** fixed the admin totalCount ([a909a58](https://github.com/Jaal-Yantra-Textiles/v2/commit/a909a5860b0b592047ec093165475ad151295551))


### Features

* **api:** Socials with twitter services online now ([cd62a46](https://github.com/Jaal-Yantra-Textiles/v2/commit/cd62a46a607a3238b25639c221a05b5a44af1377))

## [6.33.2](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.33.1...v6.33.2) (2025-11-17)


### Bug Fixes

* **admin:** fixed the map data returning settings ([1a889a2](https://github.com/Jaal-Yantra-Textiles/v2/commit/1a889a2e7910da488171aa9b96f57619d1c9fa17))

## [6.33.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.33.0...v6.33.1) (2025-11-17)


### Bug Fixes

* **api:** Agreement now renamed to agreements ([dafa4ef](https://github.com/Jaal-Yantra-Textiles/v2/commit/dafa4ef25ccd76e995b7b572296d2b966afb66fe))

# [6.33.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.32.2...v6.33.0) (2025-11-17)


### Features

* **api:** Socials , initial fetch loader, fail try again on socials ([36671e8](https://github.com/Jaal-Yantra-Textiles/v2/commit/36671e813886c7d483e24abb81cc99cdb3ebee5b))

## [6.32.2](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.32.1...v6.32.2) (2025-11-15)


### Bug Fixes

* **workflows:** Fixed the publish both token issue at the fb insta ([0b7bc8b](https://github.com/Jaal-Yantra-Textiles/v2/commit/0b7bc8bc08a9d7d41f35b7c7753ce50f96ad1364))
* **api:** Signature issue resolved for the socials ([5903d61](https://github.com/Jaal-Yantra-Textiles/v2/commit/5903d61109e3f25655961122d95a5ce8ce842b30))

## [6.32.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.32.0...v6.32.1) (2025-11-15)


### Bug Fixes

* **scripts:** Fixed git scripts one command workflow ([d2b29b2](https://github.com/Jaal-Yantra-Textiles/v2/commit/d2b29b24af37df047b38dfbe935fc55059cbf6f3))

# [6.32.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.31.2...v6.32.0) (2025-11-15)


### Features

* **Esty:** Product now support etsy sync ([8be1c26](https://github.com/Jaal-Yantra-Textiles/v2/commit/8be1c26c95d60acce85b24ab57bb0eed0d187720))
* **Media:** Upload now efficiently smoothen out ([4ce8e8e](https://github.com/Jaal-Yantra-Textiles/v2/commit/4ce8e8ef8c86eafd229fb730ecb3d8cda6903985))

## [6.31.2](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.31.1...v6.31.2) (2025-11-13)


### Bug Fixes

* **Web:** blog route fix with get filters ([517efaf](https://github.com/Jaal-Yantra-Textiles/v2/commit/517efaf7b97ec8e3cb323fa45c3da53037f708d2))
* **Blogs:** Old array to new format ([2e609ba](https://github.com/Jaal-Yantra-Textiles/v2/commit/2e609ba9fb9ced6033f8e7b73edf74410ebb50bb))

## [6.31.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.31.0...v6.31.1) (2025-11-13)


### Bug Fixes

* **Website Blocks:** Editor fixed to use the JSON editor ([45c4669](https://github.com/Jaal-Yantra-Textiles/v2/commit/45c4669ba9a766e5bf99135f1194336ab1a8a07a))
* **Blog block:** fixed the blog block ([81303e0](https://github.com/Jaal-Yantra-Textiles/v2/commit/81303e0b048787b830ece71731fab0b25d6f54df))

# [6.31.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.30.1...v6.31.0) (2025-11-12)


### Features

* **Custom Analytics:** fixed custom analytics inside to show maps ([db375a1](https://github.com/Jaal-Yantra-Textiles/v2/commit/db375a1e305b16127778c6265323e2446116ac39))

## [6.30.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.30.0...v6.30.1) (2025-11-12)


### Bug Fixes

* **actions:** update analytics deployment to use S3-compatible credentials ([0b2bf22](https://github.com/Jaal-Yantra-Textiles/v2/commit/0b2bf228b6089fdfd9504ea2471e37a524aaedc9))

# [6.30.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.29.0...v6.30.0) (2025-11-12)


### Bug Fixes

* **Middlewares:** Fixed the cors header settings ([7bc6323](https://github.com/Jaal-Yantra-Textiles/v2/commit/7bc6323e18b61174243bca55e8c3ea8d31524c40))


### Features

* **Github:** Actions for deploying the analytics js ([c0d80cf](https://github.com/Jaal-Yantra-Textiles/v2/commit/c0d80cfbeed9f1f75d5400666bfae2d59abe9845))

# [6.29.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.28.1...v6.29.0) (2025-11-12)


### Features

* **Web:** Cors setting for get and options ([c06a878](https://github.com/Jaal-Yantra-Textiles/v2/commit/c06a878d1c2614de2256740da6209f7817c64be7))

## [6.28.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.28.0...v6.28.1) (2025-11-11)


### Bug Fixes

* **Medias:** User upload manager hook replaced ([b1b41c0](https://github.com/Jaal-Yantra-Textiles/v2/commit/b1b41c0fbc78032f6e45b9898982c7982039ca0a))

# [6.28.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.27.2...v6.28.0) (2025-11-11)


### Bug Fixes

* **Custom Analytics:** Removed the trailing slash ([9269f6c](https://github.com/Jaal-Yantra-Textiles/v2/commit/9269f6c3eecd61054347dbfd6622d401e3dec872))


### Features

* **Custom Analytics:** Polished UI to view analtyical data ([ad12c6e](https://github.com/Jaal-Yantra-Textiles/v2/commit/ad12c6e1e7282e4df7d66275dbe580dc4a05021c))

## [6.27.2](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.27.1...v6.27.2) (2025-11-10)


### Bug Fixes

* **Websocket:** fixed the websocket slash issue ([91e0be1](https://github.com/Jaal-Yantra-Textiles/v2/commit/91e0be1c0c7d304491afd79d5728d64c8bb8f8ca))
* **Socials:** Posting instagram and faecbook can multi-select images ([035386e](https://github.com/Jaal-Yantra-Textiles/v2/commit/035386e88e37125cf113bf4ebd150150410ea06e))

## [6.27.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.27.0...v6.27.1) (2025-11-10)


### Bug Fixes

* **Custom Analytics:** Fixed the api url for the live session tracking ([a9ac421](https://github.com/Jaal-Yantra-Textiles/v2/commit/a9ac421769ed31ff2bf6b5e9534cecf536a1c593))

# [6.27.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.26.0...v6.27.0) (2025-11-10)


### Bug Fixes

* **Custom Analytics:** Custom Analytics to replace the plausible script ([78290f6](https://github.com/Jaal-Yantra-Textiles/v2/commit/78290f67da8145dd856419f591c19d521e8834c8))


### Features

* **Feedback:** Module feedback for the partnet and inventory order fixed ([4fc2e7d](https://github.com/Jaal-Yantra-Textiles/v2/commit/4fc2e7d06ec79c68e9a84085605ccd0706d3bc06))

# [6.26.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.25.13...v6.26.0) (2025-11-08)


### Bug Fixes

* **images:** Transformation fix for the url jyt ([7bbb1e5](https://github.com/Jaal-Yantra-Textiles/v2/commit/7bbb1e59fdf347eb69349057eeecf256f4740860))


### Features

* **Socials:** Social medias can store returning data from the post ([0ab504c](https://github.com/Jaal-Yantra-Textiles/v2/commit/0ab504c4cb2c6ec17f5edb04c62f16558ecd3af2))

## [6.25.13](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.25.12...v6.25.13) (2025-11-08)


### Bug Fixes

* **Social:** Instagram acess token ([87d2e2a](https://github.com/Jaal-Yantra-Textiles/v2/commit/87d2e2af11bc09b93e09934d231905de276c38f5))

## [6.25.12](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.25.11...v6.25.12) (2025-11-07)


### Bug Fixes

* **Social:** page id publishing fix for both ([b01399d](https://github.com/Jaal-Yantra-Textiles/v2/commit/b01399d4d5233a7d78a7fe8a01f49fd8eed0a418))
* **Socials:** pageID fix ([eb51698](https://github.com/Jaal-Yantra-Textiles/v2/commit/eb5169806bd4c5bc3d0a893ebd7f9137778ab7df))

## [6.25.11](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.25.10...v6.25.11) (2025-11-07)


### Bug Fixes

* **Socials:** Facebook social media post link bug fix ([e9794a7](https://github.com/Jaal-Yantra-Textiles/v2/commit/e9794a7dc071418bb694ec92a00d3b4b2775ce6d))
* **Social:** page ID social publishing fix ([e90625d](https://github.com/Jaal-Yantra-Textiles/v2/commit/e90625ddae4cb24ae3e2e7d5c70c5ce2cb1a221c))

## [6.25.10](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.25.9...v6.25.10) (2025-11-07)


### Bug Fixes

* **Socials:** page_id and auto publish text fix ([578757c](https://github.com/Jaal-Yantra-Textiles/v2/commit/578757c242c3154602ab3de40bd8f0e40bc6553a))

## [6.25.9](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.25.8...v6.25.9) (2025-11-06)

## [6.25.8](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.25.7...v6.25.8) (2025-11-06)


### Bug Fixes

* **Partner:** Fixing the partner tasks UI and API ([386f622](https://github.com/Jaal-Yantra-Textiles/v2/commit/386f622c57df1d3a70a7aa8f223981c41092e59f))

## [6.25.7](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.25.6...v6.25.7) (2025-11-06)


### Bug Fixes

* **Package:** ORM Fix code for the pacakge ([5ba3b30](https://github.com/Jaal-Yantra-Textiles/v2/commit/5ba3b30eec843f6d5022245121c4bac6cb7fe0f8))

## [6.25.6](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.25.5...v6.25.6) (2025-11-06)


### Bug Fixes

* **Package:** Orm fix package removed ([cd0ec1e](https://github.com/Jaal-Yantra-Textiles/v2/commit/cd0ec1e1cf644ffeccf33ee0691175aa3773fbf0))

## [6.25.5](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.25.4...v6.25.5) (2025-11-06)


### Bug Fixes

* **type script:** fixed the typescript error ([3ab722a](https://github.com/Jaal-Yantra-Textiles/v2/commit/3ab722a42b3c393ecb9efaaecbe78c5e5d856637))

## [6.25.4](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.25.3...v6.25.4) (2025-11-05)


### Bug Fixes

* **Partner:** fixed login issues at the partner level ([bb0f231](https://github.com/Jaal-Yantra-Textiles/v2/commit/bb0f2310fdac33f0a4eab9f2107449bb7a0bdebe))
* **Partner:** Old Auth scope fixed ([f2bc202](https://github.com/Jaal-Yantra-Textiles/v2/commit/f2bc2029e5acfd97e64cdf033bcb2a6f888c5d33))

## [6.25.3](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.25.2...v6.25.3) (2025-11-05)


### Bug Fixes

* **Partner:** fixing the login and logut partner issue ([8e9686b](https://github.com/Jaal-Yantra-Textiles/v2/commit/8e9686b11a78f8ba47791d0c7f8a4974c0918e13))

## [6.25.2](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.25.1...v6.25.2) (2025-11-05)


### Bug Fixes

* **Partner:** Fixed cookies ([7a86cde](https://github.com/Jaal-Yantra-Textiles/v2/commit/7a86cdea2a5603cf98d50ec35ad8d1caca2f6b91))

## [6.25.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.25.0...v6.25.1) (2025-11-05)


### Bug Fixes

* **Partner:** fixed the build ([6d91449](https://github.com/Jaal-Yantra-Textiles/v2/commit/6d914497b065e18b2510df8820b665811c15defd))
* **2:** Fixed the prod issue with indexing engine ([bb6c675](https://github.com/Jaal-Yantra-Textiles/v2/commit/bb6c67560c70f5a8e67832391a42a1aaa93b3f66))

# [6.25.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.24.0...v6.25.0) (2025-11-05)


### Bug Fixes

* **Package:** date-fns ([c56d045](https://github.com/Jaal-Yantra-Textiles/v2/commit/c56d045376eaca039089cf50518300ac0f44a2ec))


### Features

* **Partner:** Now can see the tasks ([6e52ee7](https://github.com/Jaal-Yantra-Textiles/v2/commit/6e52ee7d92c279d93e9112aac10cd24629dd0229))

# [6.24.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.23.0...v6.24.0) (2025-11-05)


### Features

* **INVO:** Inventory order has not edit option ([75d8674](https://github.com/Jaal-Yantra-Textiles/v2/commit/75d8674954980bc6e7241954ef0a7c59f7854695))
* **Designs:** Now,we can de-link the inventory line from the designs ([7b75efd](https://github.com/Jaal-Yantra-Textiles/v2/commit/7b75efd79f7b124ae380647e709ff415daf3444b))

# [6.23.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.22.0...v6.23.0) (2025-10-14)


### Features

* **Notification:** Fixed "order-fulfillment-procured ([2026239](https://github.com/Jaal-Yantra-Textiles/v2/commit/20262397b038e857b13380e9404304b70d38d4b5))

# [6.22.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.21.1...v6.22.0) (2025-10-11)


### Features

* **LLM:** Now, we can generate product description on the fly ([0d8e8ae](https://github.com/Jaal-Yantra-Textiles/v2/commit/0d8e8ae928a48a638e3d3e629113b095496080dc))

## [6.21.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.21.0...v6.21.1) (2025-10-09)


### Performance Improvements

* **Medias:** Fixed the image loading ([6015225](https://github.com/Jaal-Yantra-Textiles/v2/commit/601522506c4e70fc6fe7eff4d372306ca25e35bf))

# [6.21.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.20.6...v6.21.0) (2025-10-09)


### Features

* **Medias:** Now, we can associate existing products view from editor files ([289894b](https://github.com/Jaal-Yantra-Textiles/v2/commit/289894bdd95a8016c35a050da6b01ed895e5f7fe))

## [6.20.6](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.20.5...v6.20.6) (2025-09-25)


### Bug Fixes

* **Person Types:** fixed a small bug for validator in the middlewares ([c88edfc](https://github.com/Jaal-Yantra-Textiles/v2/commit/c88edfc3bb01408dab35a6f60df5e5988efab022))

## [6.20.5](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.20.4...v6.20.5) (2025-09-24)

## [6.20.4](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.20.3...v6.20.4) (2025-09-24)


### Bug Fixes

* **Medias:** Fixed the media low resolution ([1a2263f](https://github.com/Jaal-Yantra-Textiles/v2/commit/1a2263faaa6628bb1b6ca71074fe157684d1b1ce))

## [6.20.3](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.20.2...v6.20.3) (2025-09-24)

## [6.20.2](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.20.1...v6.20.2) (2025-09-24)


### Bug Fixes

* **Medias:** Fixed the file upload url thing ([9245c91](https://github.com/Jaal-Yantra-Textiles/v2/commit/9245c916c6a9a7194eb239e560dbd959ca01dd32))

## [6.20.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.20.0...v6.20.1) (2025-09-23)


### Bug Fixes

* **Medias:** Medias upload command selection with delete option ([76d5e05](https://github.com/Jaal-Yantra-Textiles/v2/commit/76d5e059130dd3ba1d91b5852662899893074fa7))

# [6.20.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.19.2...v6.20.0) (2025-09-23)


### Features

* **Products:** People and QR code gen ([975dd5e](https://github.com/Jaal-Yantra-Textiles/v2/commit/975dd5e3b08897a1dc73cc793131a3ca77146458))

## [6.19.2](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.19.1...v6.19.2) (2025-09-22)

## [6.19.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.19.0...v6.19.1) (2025-09-22)


### Bug Fixes

* **Payment:** Internal payment fix api because of the plural s ([d60d47d](https://github.com/Jaal-Yantra-Textiles/v2/commit/d60d47dd4b09bd050839bb031fc6901d49036310))

# [6.19.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.18.5...v6.19.0) (2025-09-22)


### Bug Fixes

* **Partner:** Fixing the partner type script ([a6e50e3](https://github.com/Jaal-Yantra-Textiles/v2/commit/a6e50e3cdca331d557930d339881d84ad88ec1d8))
* **Inventory:** Orders now reflect the inventory order stock location wise ([a9b276d](https://github.com/Jaal-Yantra-Textiles/v2/commit/a9b276da327a5c746b9778506b0daf664ef46c42))


### Features

* **Partner:** Inventory scope added to the partner focus area ([3a48571](https://github.com/Jaal-Yantra-Textiles/v2/commit/3a48571e53a4358028e82c34b6c323671b84a409))

## [6.18.5](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.18.4...v6.18.5) (2025-09-21)


### Bug Fixes

* **Files:** Upload url downstream s3 fix ([0ea5e72](https://github.com/Jaal-Yantra-Textiles/v2/commit/0ea5e72abfa913a58e2faefd196aff5b9be36fb7))

## [6.18.4](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.18.3...v6.18.4) (2025-09-21)


### Bug Fixes

* **2:** Files ([b5b96b7](https://github.com/Jaal-Yantra-Textiles/v2/commit/b5b96b76742baa7cb6551c19db8964c74d7a07b5))

## [6.18.3](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.18.2...v6.18.3) (2025-09-21)


### Bug Fixes

* **Partner:** build issue fixed ([035e52a](https://github.com/Jaal-Yantra-Textiles/v2/commit/035e52ab60200ad146867e882c881a902ab5459e))

## [6.18.2](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.18.1...v6.18.2) (2025-09-21)


### Bug Fixes

* **files:** Upload from partner now supports the S3 streaming ([164ddb4](https://github.com/Jaal-Yantra-Textiles/v2/commit/164ddb4273de54b11b2f9c999b71965eba2a6aa1))

## [6.18.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.18.0...v6.18.1) (2025-09-21)


### Bug Fixes

* **Error:** reporting sentry API ([285e08b](https://github.com/Jaal-Yantra-Textiles/v2/commit/285e08b6ac176b5ff7c401955b90bfd697523b74))

# [6.18.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.17.4...v6.18.0) (2025-09-21)


### Features

* **Instrumentation:** Sentry integration to partner and backend service ([01589fd](https://github.com/Jaal-Yantra-Textiles/v2/commit/01589fdda26efa9c2ad65c5c9dcdd6de9f3d613c))

## [6.17.4](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.17.3...v6.17.4) (2025-09-20)


### Bug Fixes

* **Proxy:** Fixed proxy issues ([f3fec27](https://github.com/Jaal-Yantra-Textiles/v2/commit/f3fec276c24a45fd9b31b9ef72e246ce89db3a59))
* **Proxy:** removed proxy API ([e083099](https://github.com/Jaal-Yantra-Textiles/v2/commit/e08309926d06c6ab3ccc215e916443ababc865d8))

## [6.17.3](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.17.2...v6.17.3) (2025-09-20)


### Bug Fixes

* **UI:** Partner Dashboard UI ([76745d9](https://github.com/Jaal-Yantra-Textiles/v2/commit/76745d9de7ab6cdcf7acbb0e0fd88c8cedf50c1b))

## [6.17.2](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.17.1...v6.17.2) (2025-09-19)


### Bug Fixes

* **UI:** Partner UI fixes ([12e0444](https://github.com/Jaal-Yantra-Textiles/v2/commit/12e04442247f97cbf4aa84111944806dbd7f5b8d))

## [6.17.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.17.0...v6.17.1) (2025-09-19)


### Bug Fixes

* **Medias:** Now we can upload media large files ([af95a36](https://github.com/Jaal-Yantra-Textiles/v2/commit/af95a3616d06b99066f0366ff549db326ae42afb))

# [6.17.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.16.0...v6.17.0) (2025-09-19)


### Bug Fixes

* **UI:** Feed channel sending fix ([ec62d01](https://github.com/Jaal-Yantra-Textiles/v2/commit/ec62d01a0a7b3cf68fe538430ee6b9ed681e3f20))


### Features

* **UI:** Partner UI polished ([3ce70c3](https://github.com/Jaal-Yantra-Textiles/v2/commit/3ce70c339948aecc5698e101d95a5375262811f8))

# [6.16.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.15.1...v6.16.0) (2025-09-18)


### Features

* **UI:** Partner UI upgrade ([6bbcab5](https://github.com/Jaal-Yantra-Textiles/v2/commit/6bbcab533a0411da57eda5d790c172a614409532))

## [6.15.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.15.0...v6.15.1) (2025-09-18)


### Bug Fixes

* **UI:** Partner UI fixes ([fbd0275](https://github.com/Jaal-Yantra-Textiles/v2/commit/fbd02754530f7adaed462c4077620467130dce44))

# [6.15.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.14.3...v6.15.0) (2025-09-18)


### Features

* **UI:** Changes in the partner UI ([8e9ab11](https://github.com/Jaal-Yantra-Textiles/v2/commit/8e9ab11cc515bbc11ea5aab7d8dad97c07a3a633))

## [6.14.3](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.14.2...v6.14.3) (2025-09-18)


### Bug Fixes

* **Workflow:** Fixed the inventory order long term workflow ([343f291](https://github.com/Jaal-Yantra-Textiles/v2/commit/343f2912083ad3a51a0d74ed2a9a2cf38a234d7c))
* **Workflows:** Workflows bug fixes ([ca63ea7](https://github.com/Jaal-Yantra-Textiles/v2/commit/ca63ea7c0ee11c3a685d183ad00e1e9eaf64b728))

## [6.14.2](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.14.1...v6.14.2) (2025-09-15)


### Bug Fixes

* **INVO:** Inventory order notification fix ([db836c4](https://github.com/Jaal-Yantra-Textiles/v2/commit/db836c4ee01133db577910a17ba347bfbed70bbb))

## [6.14.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.14.0...v6.14.1) (2025-09-15)


### Bug Fixes

* **INVO:** Inventory order workflow fixes ([2b9a29a](https://github.com/Jaal-Yantra-Textiles/v2/commit/2b9a29a997806016e27ee5fce598d46b0d2163bb))

# [6.14.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.13.10...v6.14.0) (2025-09-14)


### Features

* **Editor:** Fixed editor inside the website pages ([963fb01](https://github.com/Jaal-Yantra-Textiles/v2/commit/963fb01758cb330945a8aa0b4f7dd9401d90f69e))

## [6.13.10](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.13.9...v6.13.10) (2025-09-12)

## [6.13.9](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.13.8...v6.13.9) (2025-09-10)


### Bug Fixes

* **product:** Design linking now works with pagination ([27573d1](https://github.com/Jaal-Yantra-Textiles/v2/commit/27573d10cf71d2521ca2257bc8001cea4d9657e6))

## [6.13.8](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.13.7...v6.13.8) (2025-09-09)


### Bug Fixes

* **Media:** fixed the large media upload issue ([e9d9006](https://github.com/Jaal-Yantra-Textiles/v2/commit/e9d9006be88322c420769dd6629c9963a4f2cb77))

## [6.13.7](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.13.6...v6.13.7) (2025-09-09)


### Bug Fixes

* **Design:** Design editor notes section fixed ([4bd274d](https://github.com/Jaal-Yantra-Textiles/v2/commit/4bd274d1ef78e6154b9377df89c5f56f7fed8d2d))

## [6.13.6](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.13.5...v6.13.6) (2025-09-09)


### Bug Fixes

* **Media:** File Upload Console Logs ([e7ea7e9](https://github.com/Jaal-Yantra-Textiles/v2/commit/e7ea7e9a95dcaeb5b2c240b9352c1d899335760d))

## [6.13.5](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.13.4...v6.13.5) (2025-09-09)


### Bug Fixes

* **Medias:** File upload with local storage ([67be6b3](https://github.com/Jaal-Yantra-Textiles/v2/commit/67be6b3239343c16ea91cdc1ffdd18a38ec176d3))
* **Media:** Media page filter boolean fix ([60d5156](https://github.com/Jaal-Yantra-Textiles/v2/commit/60d5156909f0a16229fc90db1779da77e8954b2e))

## [6.13.4](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.13.3...v6.13.4) (2025-09-08)

## [6.13.3](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.13.2...v6.13.3) (2025-09-08)


### Bug Fixes

* **File Upload:** Fixed large media upload ([e232a1a](https://github.com/Jaal-Yantra-Textiles/v2/commit/e232a1a5f581c8aeda677316aa785af170e1493d))

## [6.13.2](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.13.1...v6.13.2) (2025-09-07)


### Bug Fixes

* **Password:** Partner password creation takes place in proper hashed format ([044ed7d](https://github.com/Jaal-Yantra-Textiles/v2/commit/044ed7d484bd6d2be1302271dff6b3cb7f201bbd))

## [6.13.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.13.0...v6.13.1) (2025-08-29)


### Bug Fixes

* **Design:** Partner design workflow issues ([abee222](https://github.com/Jaal-Yantra-Textiles/v2/commit/abee2222b3ee450d47fd31ca0166e88ea6687c7c))

# [6.13.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.12.0...v6.13.0) (2025-08-29)


### Features

* **Social:** Now, we can publish facebook and instagram posts directly from the suite ([8f19c03](https://github.com/Jaal-Yantra-Textiles/v2/commit/8f19c034f00f290bdf89e44301e43efc9f91d8ba))

# [6.12.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.11.0...v6.12.0) (2025-08-26)


### Features

* **Partner:** Scoping for verifying and redoing implemented ([956cf64](https://github.com/Jaal-Yantra-Textiles/v2/commit/956cf6472c89c27cd0162ce4f3cf9556397cbc2b))

# [6.11.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.10.0...v6.11.0) (2025-08-25)


### Features

* **Partner:** Api now supports the redo operation ([99d96d6](https://github.com/Jaal-Yantra-Textiles/v2/commit/99d96d65c076ee7911f7972dfc183b4e13815fde))
* **Partner:** Fixed adding new designs ([61a79d8](https://github.com/Jaal-Yantra-Textiles/v2/commit/61a79d80b893db45e40a04e398e65937791524d4))

# [6.10.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.9.0...v6.10.0) (2025-08-23)


### Features

* **Partner:** API that can create partner by sending them an email ([2a3efdb](https://github.com/Jaal-Yantra-Textiles/v2/commit/2a3efdb508ce8bf03237fac9825fa450630c2b27))

# [6.9.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.8.0...v6.9.0) (2025-08-23)


### Features

* **Payment:** Payments can be marked as complete ([fd31eab](https://github.com/Jaal-Yantra-Textiles/v2/commit/fd31eabcb1431163dcc4f72d36d4bfba4fa6863f))

# [6.8.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.7.1...v6.8.0) (2025-08-23)


### Features

* **Partner:** Partners can now start a store and add products ([4cb4db1](https://github.com/Jaal-Yantra-Textiles/v2/commit/4cb4db1a88231f6d59ef00c74b2c50e730d8a4d4))

## [6.7.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.7.0...v6.7.1) (2025-08-22)


### Bug Fixes

* **Partner API:** Partner API Single Get ([d3aee81](https://github.com/Jaal-Yantra-Textiles/v2/commit/d3aee8125fb26d5a5587ce3ed3e3edcc51a45c49))

# [6.7.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.6.7...v6.7.0) (2025-08-21)


### Bug Fixes

* **Partner:** Payment methods and some logs ([b48b502](https://github.com/Jaal-Yantra-Textiles/v2/commit/b48b5020735fb6b282b00ac23784d090f41339ab))


### Features

* **Partners:** can be now assigned succesfully ([a15d98e](https://github.com/Jaal-Yantra-Textiles/v2/commit/a15d98ef4a7aaa2d1f0ebceace708b7f628c8efc))

## [6.6.7](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.6.6...v6.6.7) (2025-08-21)


### Bug Fixes

* **Partner:** Payment for partner is now showing ([6c60b90](https://github.com/Jaal-Yantra-Textiles/v2/commit/6c60b906385e1617bcffbc930ddab73e05fbf92d))

## [6.6.6](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.6.5...v6.6.6) (2025-08-21)


### Bug Fixes

* **Partner:** API endpoint issue resolvied ([bf5b735](https://github.com/Jaal-Yantra-Textiles/v2/commit/bf5b735fd2da7660fbdd0c1edb51b1f5e1f638fb))

## [6.6.5](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.6.4...v6.6.5) (2025-08-21)


### Bug Fixes

* **Partner:** Fixed partner decimal values ([e5acfa1](https://github.com/Jaal-Yantra-Textiles/v2/commit/e5acfa1d15af3d69c311cda4fc6e401ff9e599fb))
* **Partner:** Partner API not getting assigned ([2a514d9](https://github.com/Jaal-Yantra-Textiles/v2/commit/2a514d96fb5b2346ca0d0336dddaa54487326802))
* **Partner:** Removed unused code stub ([fd6816e](https://github.com/Jaal-Yantra-Textiles/v2/commit/fd6816e6cc4d82b6bdb64d5258c23ac2178eb31b))

## [6.6.4](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.6.3...v6.6.4) (2025-08-21)

## [6.6.3](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.6.2...v6.6.3) (2025-08-21)

## [6.6.2](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.6.1...v6.6.2) (2025-08-21)

## [6.6.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.6.0...v6.6.1) (2025-08-20)


### Bug Fixes

* **INVO:** Inventory Order image extraction bug fix ([d07beb4](https://github.com/Jaal-Yantra-Textiles/v2/commit/d07beb4ef5a3a61270b5eee1627687dbe82a6631))

# [6.6.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.5.0...v6.6.0) (2025-08-20)


### Features

* **Media:** UI changes to use the progress indicator ([a5f7698](https://github.com/Jaal-Yantra-Textiles/v2/commit/a5f7698fff8b3cf492f4c540214edd97d3a9ac5b))

# [6.5.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.4.0...v6.5.0) (2025-08-20)


### Features

* **Partner:** Design Provider Added in Partner Scope ([da3c9dd](https://github.com/Jaal-Yantra-Textiles/v2/commit/da3c9ddee0be66b06e8942838f0c4b0b3a95005b))
* **Designs:** Partner Workflow With Redo Option ([f42eebc](https://github.com/Jaal-Yantra-Textiles/v2/commit/f42eebc66a9adeefcd45d68e1d1cdf1b18c94083))

# [6.4.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.3.0...v6.4.0) (2025-08-20)


### Features

* **OpenAPI:** API's working with different llms to work with ([bd51bf4](https://github.com/Jaal-Yantra-Textiles/v2/commit/bd51bf4999725de4f1ea1351e264cc0f7dc1ba5a))

# [6.3.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.2.1...v6.3.0) (2025-08-11)


### Features

* **Payments:** Internal Payment and Methods ([b180c64](https://github.com/Jaal-Yantra-Textiles/v2/commit/b180c6466b4167b09bd6b94fda82b69ed6b666ef))

## [6.2.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.2.0...v6.2.1) (2025-08-10)

# [6.2.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.1.0...v6.2.0) (2025-08-10)


### Features

* Partner UI and Inventory Order Partial Testing ([a0d4938](https://github.com/Jaal-Yantra-Textiles/v2/commit/a0d49385a2f546fd7e520350ed99f57a267cf82d))

# [6.1.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.0.1...v6.1.0) (2025-08-07)


### Bug Fixes

* **Build:** Added ts no check for now ([e8ec4e1](https://github.com/Jaal-Yantra-Textiles/v2/commit/e8ec4e1adf3110ca4e65d4f7bcbbfd5d61feccad))
* **Agreement:** API returning data with handlebars ([82467aa](https://github.com/Jaal-Yantra-Textiles/v2/commit/82467aaf7370c8acdf328f1a48d6838e9d1d31e4))
* **Email:** Email templates bug fix ([b60586e](https://github.com/Jaal-Yantra-Textiles/v2/commit/b60586ef880de8f2b1b9d98640e83b7b88c8e73e))
* **Medusa Config:** Fixed the medusa config ([2c8d764](https://github.com/Jaal-Yantra-Textiles/v2/commit/2c8d764abe5adfa7f7c7817c83fb6879f2ff7023))
* **UI:** giving me crap vibes ([585c2e7](https://github.com/Jaal-Yantra-Textiles/v2/commit/585c2e77949f263041ca8347737bc7191f80319a))
* **Meta Fix:** Import meta thingy caused a severe headache now resolved. Always remember that the front end code should not reach inside backend at all ([16f7b3d](https://github.com/Jaal-Yantra-Textiles/v2/commit/16f7b3ded2bf26abed101d87c3d4f3f8350dd55d))
* **Person:** Person test api bug fix ([21c752f](https://github.com/Jaal-Yantra-Textiles/v2/commit/21c752fb0608e3a3d1a4dac23be95e14cd7e0d02))
* Rollup file import ([f1dc8aa](https://github.com/Jaal-Yantra-Textiles/v2/commit/f1dc8aa1aa8bdf6a15b83dbcdee7a10d5456b410))
* SDK was imported inside the editor directl ([a36ca35](https://github.com/Jaal-Yantra-Textiles/v2/commit/a36ca354a4c94dec72826b7dde7df5193c268f2a))
* **User:** Suspension and Unsuspension feature added ([fce3375](https://github.com/Jaal-Yantra-Textiles/v2/commit/fce337589b4cf41b58b83abbde1bab6368cdcbe6))


### Features

* **Modules:** Agreements,Email Templates ([132b643](https://github.com/Jaal-Yantra-Textiles/v2/commit/132b64365b086c4ca76ac48160ab85358a5d9df6))
* Create Inventory Order Line ([b6762a7](https://github.com/Jaal-Yantra-Textiles/v2/commit/b6762a75e6e79c2a831dba8aeb4f473381f07ef9))
* **Data Grid:** Data grid inside the order inventory lines ([e0ce77f](https://github.com/Jaal-Yantra-Textiles/v2/commit/e0ce77f87e9922686e8a3ae529885ea1c1d8f0f3))
* **UI:** Designs can be linked to products using the widgets ([49c98a2](https://github.com/Jaal-Yantra-Textiles/v2/commit/49c98a2116b5538b8cea36a9d615bb1fae055623))
* **Products:** Designs can be linked to the products now and can be probably fetched to stores to behind the scenes ([86b3d48](https://github.com/Jaal-Yantra-Textiles/v2/commit/86b3d482be3be9d99229ae3979b6684624a8c26a))
* **INVO:** Enter the new phase of inventory order where inventory can be assigned to the partner and can be started, completed ([811e9c4](https://github.com/Jaal-Yantra-Textiles/v2/commit/811e9c45002ab88fabe555658340d6354403be26))
* **INVO:** Inventory Orde Lines Uses the data grid ([c557127](https://github.com/Jaal-Yantra-Textiles/v2/commit/c557127305d5723085e7b4c3dad20e1edef05be6))
* **INVO:** Inventory orders can now be tracked using tasks modules ([c6ef4b7](https://github.com/Jaal-Yantra-Textiles/v2/commit/c6ef4b79f6d1d75e3accf12af85852dde07cd8f0))
* **Media:** Media where we can store photos and everything else and track them ([c087b84](https://github.com/Jaal-Yantra-Textiles/v2/commit/c087b840f97c148800ec489da8f33f76b36522cc))
* **Persons:** Payment for people involved now can be traced ([e9a862c](https://github.com/Jaal-Yantra-Textiles/v2/commit/e9a862c652b18060d139ef42199535f67cf1b747))
* **Agreement:** Person can now send multi signed agreements ([2d61d31](https://github.com/Jaal-Yantra-Textiles/v2/commit/2d61d31e32909cf116384724aa99e9cd8bb6f825))
* **Agreements:** Send agreements and track them using the person API ([6bcee62](https://github.com/Jaal-Yantra-Textiles/v2/commit/6bcee621593a9c17582a6361ee2a00aae93e8250))
* **Shared Test Setup:** Shared setup test implemented ([136616c](https://github.com/Jaal-Yantra-Textiles/v2/commit/136616c5897df5ecc7240eee9356e471dcf9f979))


### Reverts

* **Stripe Dev Settings:** Reversed stripe dev settings ([c061ebd](https://github.com/Jaal-Yantra-Textiles/v2/commit/c061ebdac91a4f41ddf4813a1834db4537d11e52))

## [6.0.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v6.0.0...v6.0.1) (2025-07-18)

# [6.0.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v5.9.0...v6.0.0) (2025-07-18)


### Bug Fixes

* **Tiptap to HTML:** Convering Tiptap to HTML ([8f4280d](https://github.com/Jaal-Yantra-Textiles/v2/commit/8f4280db497a2cb60ac7fd14654b2da8d1fb39c1))
* **Editor Files:** Files S3 List Complete Fix ([62a8e5d](https://github.com/Jaal-Yantra-Textiles/v2/commit/62a8e5d3f065d91fe359820ab874a28d1e3234ae))
* Fixed all the stupid things that I did ([609e6c9](https://github.com/Jaal-Yantra-Textiles/v2/commit/609e6c9a36e856765c08c7345c74a86587ab8d9e))
* **Mastra:** Fixed no type script check added ([4171e71](https://github.com/Jaal-Yantra-Textiles/v2/commit/4171e71d0a405cce3655d6eb36d00ff1e2722103))
* **Package:** Fixed node js ([85a4195](https://github.com/Jaal-Yantra-Textiles/v2/commit/85a4195f9b6bb13e7b4024e08f993490be41ae45))
* **Package:** fixed pacakage version ([c91e33b](https://github.com/Jaal-Yantra-Textiles/v2/commit/c91e33b8533c4afff7568fbc88a79888c47c130b))
* **Package:** Fixed packages ([38262f7](https://github.com/Jaal-Yantra-Textiles/v2/commit/38262f7aaab7fb548a7219172be6fef78cf014dd))
* **Services:** Fixed the Build Error where the service types were not defined ([aa50e46](https://github.com/Jaal-Yantra-Textiles/v2/commit/aa50e469c9ae1dd9b94ab071abe3f9fe09ffbd8e))
* **Raw Material, Media Upload , Inventory Orders, Dynamic form bug:** Fixed the inventory orders, media upload on the raw material form, dynamic form bug fix ([c9ca6d5](https://github.com/Jaal-Yantra-Textiles/v2/commit/c9ca6d5ab574818761d4eb460aaa4472981cdec1))
* **Partner:** Fixed the package files ([7497d1d](https://github.com/Jaal-Yantra-Textiles/v2/commit/7497d1dd0339cf44496267c77ac7f6f39a561c55))
* **Package:** fixed the package version for the node ([d34bafa](https://github.com/Jaal-Yantra-Textiles/v2/commit/d34bafac77ee7f4f8e4e09812fa3eca656e3dc74))
* Fixed the package.json ([f2aebb1](https://github.com/Jaal-Yantra-Textiles/v2/commit/f2aebb1b347321886990c7630456e1ff1ee08dcf))
* **Editor Files:** Fixed the prefix on listing of all the files ([8cd7aec](https://github.com/Jaal-Yantra-Textiles/v2/commit/8cd7aec852bdc31fa02c7cd5e5951b3a4f252016))
* **Editor files:** Fixed the prefix ([75fe722](https://github.com/Jaal-Yantra-Textiles/v2/commit/75fe722c48d68969fd111bf4e91a3019d85ed563))
* **S3:** Fixed the S3 Listing feature ([9f2e750](https://github.com/Jaal-Yantra-Textiles/v2/commit/9f2e750dd31be9f1f1d69a20429335d2e7378f15))
* general file cleanup ([8fbc007](https://github.com/Jaal-Yantra-Textiles/v2/commit/8fbc0072fbf2d72df952718a8ea32988339b3b70))
* **Git:** Git messed up everything since we didnt pull before ([13a357c](https://github.com/Jaal-Yantra-Textiles/v2/commit/13a357cd8789120427a2e2ef1f587bf83afe8ddb))
* **GIT:** git pull conflict fix ([b76daf1](https://github.com/Jaal-Yantra-Textiles/v2/commit/b76daf10c49ae6639f184a2f819516b18d3837ee))
* **Editor Files:** List all files was throwing an error on the specified key does not exist ([6359053](https://github.com/Jaal-Yantra-Textiles/v2/commit/63590535ab8c066f9f3d599c494bbf40763b26cf))
* **Migration:** Migration script failing on production fixed a patch for Migration20250417085315 ([eb81ed0](https://github.com/Jaal-Yantra-Textiles/v2/commit/eb81ed0dcc176b90f1da16d4adb31d27470bd89e))
* **Migration:** Migration script fix inside the social post ([bfdcc76](https://github.com/Jaal-Yantra-Textiles/v2/commit/bfdcc76e6d202e425cd7917a0bee54ea66488906))
* **Design Moodboard:** Moodboard on save ([b949df8](https://github.com/Jaal-Yantra-Textiles/v2/commit/b949df82418705fe0224e79d5f29032b99bfbfe4))
* **UI,API:** Moodboard save, create manual design ([3b7c18f](https://github.com/Jaal-Yantra-Textiles/v2/commit/3b7c18f335db5be3d851fc1e70a28c9412cd7d2a))
* **package:** Package fix for the vite ([01fce7f](https://github.com/Jaal-Yantra-Textiles/v2/commit/01fce7f32d6fa6b696f7d6a4001b91a38f4143e9))
* **Persons Import:** PI , feature with other data model types ([b608cac](https://github.com/Jaal-Yantra-Textiles/v2/commit/b608cac19f882f4eeade3835caeabcae8f00a5e7))
* Removing DS_store ([f8cea0a](https://github.com/Jaal-Yantra-Textiles/v2/commit/f8cea0aeabad38f760dfeda01f01413a961e4cd7))
* **WEB:** RouteFocusModal top level missing on top of the editwebsite modal ([9098afa](https://github.com/Jaal-Yantra-Textiles/v2/commit/9098afa043cb4da82204cb601c48e8e9e51d7068))
* **Modules:** Social and Social Providers Modules Resolution Fixed ([616c9e2](https://github.com/Jaal-Yantra-Textiles/v2/commit/616c9e246a69c7cbf51c2f16fbaf863a167a9f68))
* **WEB:** The blog had some issue when rendering on the condtion ([00d44a9](https://github.com/Jaal-Yantra-Textiles/v2/commit/00d44a95bcb621d017f024b32699f71cd8a39621))
* **AUTH:** user suspension logic check ([2a9728f](https://github.com/Jaal-Yantra-Textiles/v2/commit/2a9728f9f10279affa8383d881516102883bf636))
* **WEB:** Workflow execution takes behind the scenes now ([de255d1](https://github.com/Jaal-Yantra-Textiles/v2/commit/de255d1fc450638002eb4a08b4dd9df47a913eff))


### Features

* **Social:** Capability to generate post and publish them on the social medias like x, facebook and etc ([fead8b1](https://github.com/Jaal-Yantra-Textiles/v2/commit/fead8b1b747bd936fa1722ed68cfc38b003b2533))
* **API:** Category API route for content ([37a8c8a](https://github.com/Jaal-Yantra-Textiles/v2/commit/37a8c8a3985c12320034c6522e32496928f4beaa))
* Design Canvas and Task from Templates Feature ([d601ba4](https://github.com/Jaal-Yantra-Textiles/v2/commit/d601ba4fc3e7e5b62019b33ecadbf8717457adcd))
* **SCRIPT:** Fixed the script to generate Modules, Models, Workflows, API, and tests also. ([727e7ae](https://github.com/Jaal-Yantra-Textiles/v2/commit/727e7ae53ef74edb883e23bc5f5c48eb5f7cf12e))
* Inventory Order Scope for Warehouse ([1dca91f](https://github.com/Jaal-Yantra-Textiles/v2/commit/1dca91f94a125a4ae985d3150e27ac7eadc424bd))
* **INO:** Inventory orders can now handle the sample orders ([a95bda0](https://github.com/Jaal-Yantra-Textiles/v2/commit/a95bda0523fc3ad933db94a00c0118c62f88238f))
* **INVO:** Inventory Orders has now tasks that outline the status on the inventory orders ([ff25d80](https://github.com/Jaal-Yantra-Textiles/v2/commit/ff25d80636bb2adf8b4c4c99cc6bcbdad90499f2))
* **FILE:** List all files directly through S3 alongside the file through an API ([e741282](https://github.com/Jaal-Yantra-Textiles/v2/commit/e741282746b6cef88251489a8aac4a412070ca1c))
* **Email Test:** Now, you can test email a single person to check if the email will go right or not ([0bc5223](https://github.com/Jaal-Yantra-Textiles/v2/commit/0bc5223ae28b13f40ff3053eeda9b079a5f9bca4))
* **Send to Subscriber:** Now,we can send emails to subscriber ([296b78e](https://github.com/Jaal-Yantra-Textiles/v2/commit/296b78ee0ab0bea3d48d82a79024510832c141f6))
* **Partner:** Partner UI added horray ([4573889](https://github.com/Jaal-Yantra-Textiles/v2/commit/4573889487de6c570570f1de3561bd47817b1bc3))
* **PP:** Public Persons API ([b002a0d](https://github.com/Jaal-Yantra-Textiles/v2/commit/b002a0d6fe0c426c203cc29497f6db525c7f4bf6))
* **SCRIPT:** Script that can generate models, workflow, API and modules are in place. ([b0fb1bb](https://github.com/Jaal-Yantra-Textiles/v2/commit/b0fb1bbc3c18d2259b8fb4237a73091118be2fcf))
* **Email:** Send Email to Single Subscriber before sending to all ([20f7cb3](https://github.com/Jaal-Yantra-Textiles/v2/commit/20f7cb3d2ad8a06cfde172b29bcbfef98e9283f3))
* **Map:** Showing people with geocoding on the map view ([e5355b7](https://github.com/Jaal-Yantra-Textiles/v2/commit/e5355b7e31cc0d0e7fb1d74d4d1c4badf620ef29))
* **Payment:** Stripe Payment Update ([a2840ea](https://github.com/Jaal-Yantra-Textiles/v2/commit/a2840ea2f8679abd0295cf827074d7813ad8ece5))
* **Task templates:** Task templates in design section ([541b800](https://github.com/Jaal-Yantra-Textiles/v2/commit/541b800f3fcf6904d26b4c1dfa93cb77a824c8b7))
* **TE:** Texteditor can now make calls and provide input from the API such as how many number of persons do we have and etc. ([2645929](https://github.com/Jaal-Yantra-Textiles/v2/commit/26459299280685ab8554cd60d34e4e6127fe0888))
* **SCRIPT:** The script lets us generate modules and models on the fly you can now issue an command such as npx medusa exec ./src/scripts/create-module.ts socials, or npx ts-node src/scripts/generate-model.ts socials sma platform:string access_token:string ([6591ab0](https://github.com/Jaal-Yantra-Textiles/v2/commit/6591ab085745cc89ed400bc71b12569c345427e6))
* **Social:** We have fully integrated the twitter OAUTH using the social providers ([7393da9](https://github.com/Jaal-Yantra-Textiles/v2/commit/7393da99092e6300b5b95ca27a85733b315c7b08))
* **Person:** Web api for publically loading the weavers and people ([340d018](https://github.com/Jaal-Yantra-Textiles/v2/commit/340d01823e947c5107b85642bd171c8fbd6ea812))


### Performance Improvements

* **Build:** performance on build ([346eb02](https://github.com/Jaal-Yantra-Textiles/v2/commit/346eb02462e6ea8ac3ff163abe58a23914e2e541))
* Performance upgrade on UI and API ([15c7241](https://github.com/Jaal-Yantra-Textiles/v2/commit/15c724157ebcac5b3ee6a715928c0aa8c061d777))


### Tests

* **Test:** Fixed the testing issues finally ([8c48266](https://github.com/Jaal-Yantra-Textiles/v2/commit/8c48266a01e2a798b626b8d36f1eaff5efffa263))


### BREAKING CHANGES

* **Test:** None
* **Social:**

# [5.8.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v5.7.0...v5.8.0) (2025-06-16)


### Bug Fixes

* **WEB:** RouteFocusModal top level missing on top of the editwebsite modal ([1d11ada](https://github.com/Jaal-Yantra-Textiles/v2/commit/1d11adad4f2b674bb469af9d8d76a47e2942885c))


### Features

* **SCRIPT:** Fixed the script to generate Modules, Models, Workflows, API, and tests also. ([08e1099](https://github.com/Jaal-Yantra-Textiles/v2/commit/08e1099e6a0e3d5853a662c0981b58b944ec1f30))

# [5.7.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v5.6.1...v5.7.0) (2025-06-14)


### Features

* **FILE:** List all files directly through S3 alongside the file through an API ([17e6217](https://github.com/Jaal-Yantra-Textiles/v2/commit/17e6217bc1d6de0a920cd61d85b62d9c6fe5e4ce))
* **SCRIPT:** Script that can generate models, workflow, API and modules are in place. ([96f0826](https://github.com/Jaal-Yantra-Textiles/v2/commit/96f082608f24b4022caba4915bb4bede75ddd2c8))
* **TE:** Texteditor can now make calls and provide input from the API such as how many number of persons do we have and etc. ([19ce675](https://github.com/Jaal-Yantra-Textiles/v2/commit/19ce6756a25e51a8089625534b3ff17925fa0436))
* **SCRIPT:** The script lets us generate modules and models on the fly you can now issue an command such as npx medusa exec ./src/scripts/create-module.ts socials, or npx ts-node src/scripts/generate-model.ts socials sma platform:string access_token:string ([a492ef0](https://github.com/Jaal-Yantra-Textiles/v2/commit/a492ef0967dc462cb03f82daf924b896576751ef))

## [5.6.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v5.6.0...v5.6.1) (2025-06-13)


### Bug Fixes

* **WEB:** The blog had some issue when rendering on the condtion ([4491fda](https://github.com/Jaal-Yantra-Textiles/v2/commit/4491fdac1ca6d80a023bef4395dd9c5f0d3f6e4b))

# [5.6.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v5.5.1...v5.6.0) (2025-06-13)


### Features

* **API:** Category API route for content ([4d2311e](https://github.com/Jaal-Yantra-Textiles/v2/commit/4d2311e646fb64499892ae0e77a872b9839298be))
* **INO:** Inventory orders can now handle the sample orders ([a0401bf](https://github.com/Jaal-Yantra-Textiles/v2/commit/a0401bf8c93ca633854d80e6c9ae800f55945e76))

## [5.5.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v5.5.0...v5.5.1) (2025-06-07)


### Bug Fixes

* **Tiptap to HTML:** Convering Tiptap to HTML ([e62fdd9](https://github.com/Jaal-Yantra-Textiles/v2/commit/e62fdd9a371ebc1048ea2fd96fe7329c2191a89f))

# [5.5.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v5.4.0...v5.5.0) (2025-06-07)


### Bug Fixes

* **Services:** Fixed the Build Error where the service types were not defined ([5818523](https://github.com/Jaal-Yantra-Textiles/v2/commit/58185238e3dd6ae53e9c050e5bb0c8a66d23b149))
* **Design Moodboard:** Moodboard on save ([e1093da](https://github.com/Jaal-Yantra-Textiles/v2/commit/e1093daebc2b97671fc9e2e4c7b8762cba619b15))


### Features

* **Email Test:** Now, you can test email a single person to check if the email will go right or not ([dbfa118](https://github.com/Jaal-Yantra-Textiles/v2/commit/dbfa1181015250ecbbd0cd2d8098cc44648fda05))
* **Email:** Send Email to Single Subscriber before sending to all ([9a8077d](https://github.com/Jaal-Yantra-Textiles/v2/commit/9a8077df694246697f1660e3f55fc8ca63e77933))

# [5.4.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v5.3.1...v5.4.0) (2025-05-11)


### Features

* **Send to Subscriber:** Now,we can send emails to subscriber ([d615a16](https://github.com/Jaal-Yantra-Textiles/v2/commit/d615a1680adf69705c5a49aeef1f22b7b9d772ee))

## [5.3.1](https://github.com/Jaal-Yantra-Textiles/v2/compare/v5.3.0...v5.3.1) (2025-05-10)


### Performance Improvements

* **Build:** performance on build ([fbc2efe](https://github.com/Jaal-Yantra-Textiles/v2/commit/fbc2efec3578b90398a0a05dc8a539ae70ed8384))

# [5.3.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v5.2.0...v5.3.0) (2025-05-09)


### Bug Fixes

* **Migration:** Migration script failing on production fixed a patch for Migration20250417085315 ([08d6d07](https://github.com/Jaal-Yantra-Textiles/v2/commit/08d6d0740e31c8fcab36fafe79cba40906210923))
* **UI,API:** Moodboard save, create manual design ([7bd33e4](https://github.com/Jaal-Yantra-Textiles/v2/commit/7bd33e4dc59d032d1d1f5b47d3e6fb0d0fec745a))
* **Persons Import:** PI , feature with other data model types ([9eef1bf](https://github.com/Jaal-Yantra-Textiles/v2/commit/9eef1bf1bdb1cd504f3f55e802cb0fdc540961b5))


### Features

* Design Canvas and Task from Templates Feature ([30dd72e](https://github.com/Jaal-Yantra-Textiles/v2/commit/30dd72e0e6704dce0b2b5f85378613eea4839a5e))
* Inventory Order Scope for Warehouse ([df4523b](https://github.com/Jaal-Yantra-Textiles/v2/commit/df4523b3efb2717aeb4e778a1f6c1dc6b358b4ec))
* **Task templates:** Task templates in design section ([b79c9b5](https://github.com/Jaal-Yantra-Textiles/v2/commit/b79c9b55c389e0c9b1ec3e4815eb18a06e14d8e9))


### Performance Improvements

* Performance upgrade on UI and API ([993d387](https://github.com/Jaal-Yantra-Textiles/v2/commit/993d387206cc50e625ec7176dc23e3bec3f85c3c))

# [5.2.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v5.1.0...v5.2.0) (2025-04-17)


### Bug Fixes

* Fixed API , UI changes, website related updates, blog ([dac76c7](https://github.com/Jaal-Yantra-Textiles/v2/commit/dac76c7e7d96e8888ad84674293a5852d2bce5ca))
* Fixed the Inventory Service Issue ([727333f](https://github.com/Jaal-Yantra-Textiles/v2/commit/727333f390988d414740a298663571214248020d))


### Features

* **Inventory Orders API:** I have added an API that can record inventory orders using order lines and inventory per line tracking ([887a118](https://github.com/Jaal-Yantra-Textiles/v2/commit/887a11804d0ba971278627a7ace202a870e8256c))
* **Rich Text Editor, Inventory Orders, Inventory Lines:** We have added a functionality for the Inventory Lines and Orders and Improved the Rich Text Editor ([db39d38](https://github.com/Jaal-Yantra-Textiles/v2/commit/db39d38130438e02f0a93e66efeae506ef43b1e4))

# [5.1.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v5.0.0...v5.1.0) (2025-03-22)


### Features

* Import Person Module, we can import using the csv ([e41f085](https://github.com/Jaal-Yantra-Textiles/v2/commit/e41f08593fe3578942f954231886d80d0e5061a0))
* New organised person layout with all the details ([4898e74](https://github.com/Jaal-Yantra-Textiles/v2/commit/4898e74f4fb051fe6a4928a746acb159cff7681c))

# [5.0.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v4.0.0...v5.0.0) (2025-03-18)


### Bug Fixes

* **Raw Material Category:** Adding raw material category API other things ([d51c22d](https://github.com/Jaal-Yantra-Textiles/v2/commit/d51c22dfe77b871de179893245362b9f1b574e8a))
* Fixed PersonTable, Fixed failing test, introduced new edit methods ([3dd6d7a](https://github.com/Jaal-Yantra-Textiles/v2/commit/3dd6d7a41666547aa7ce4413cec78396f1d3b619))
* Fixed the Type Not Matching Issue on Build ([81a4fbb](https://github.com/Jaal-Yantra-Textiles/v2/commit/81a4fbbe9db707c1da3af7f1d4a8eb222df8953d))
* There was localhost set for the SDK now setting to use for the staging server ([f5d51c8](https://github.com/Jaal-Yantra-Textiles/v2/commit/f5d51c8b2b5b260e4308913408097e0b59b80b0d))


### Continuous Integration

* Fixed Deployment Issue by adding medusa build ([77a5771](https://github.com/Jaal-Yantra-Textiles/v2/commit/77a5771e2226c8a42ee8ae251a46bf1d0c45f6a6))
* Fixed the entire method for deploying the service ([f9984bd](https://github.com/Jaal-Yantra-Textiles/v2/commit/f9984bd58c89ece3bb401c0883367d938bd3e18f))


### Features

* **Design Tool:** Added the Mood Board UI and Notes Taking Section ([c04accd](https://github.com/Jaal-Yantra-Textiles/v2/commit/c04accd1d57eabf2a4236a9541ab57ab469beccc))
* **AI Domain Enhancer:** Additional AI domain Enhancer ([4d0544c](https://github.com/Jaal-Yantra-Textiles/v2/commit/4d0544c280844755e971d66a8f2adf7897bd6254))
* New Person Layout ([1d3a075](https://github.com/Jaal-Yantra-Textiles/v2/commit/1d3a075187cbec7da9a767d294026e0ba6590b7b))


### BREAKING CHANGES

* 
*

# [4.0.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v3.0.0...v4.0.0) (2025-03-06)


### Bug Fixes

* Fixed the task template category onSelect , design page table update ([92a1167](https://github.com/Jaal-Yantra-Textiles/v2/commit/92a116758b32ba97c130fc038b00045fe51c4cf7))


### Continuous Integration

* Fixed the ci node version issue ([893c5da](https://github.com/Jaal-Yantra-Textiles/v2/commit/893c5da009e8dc6910f095eb6a8832ec07862104))


### Features

* **design:** design media file upload feature ([d3e4119](https://github.com/Jaal-Yantra-Textiles/v2/commit/d3e4119a9351b4783f722f2fe0b967190a1845bb))
* Media support for the designs enabled ([4292926](https://github.com/Jaal-Yantra-Textiles/v2/commit/42929265165f2ff8d8511fdb2067baa408f95963))


### BREAKING CHANGES

*

# [3.0.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v2.0.0...v3.0.0) (2025-03-03)


### Bug Fixes

* **Fixed Design Page:** Design page now show the all the data required for displaying ([d5b8ddb](https://github.com/Jaal-Yantra-Textiles/v2/commit/d5b8ddb6b33f44bf0136d0020dea41b68ebe6a10))
* **Raw Material UI:** Fixed raw material UI and type issues ([8f44ab6](https://github.com/Jaal-Yantra-Textiles/v2/commit/8f44ab6750859915fb8f05f4dd84bc2b5be5a7e1))
* Middleware, UI Fix, Edit For Page , Workflow Fixes ([39c58c2](https://github.com/Jaal-Yantra-Textiles/v2/commit/39c58c293f56b225bb2b8a829c89b78033209221))
* **test user random:** Now we have randomly generated user for tests with unique emails ([7581cf0](https://github.com/Jaal-Yantra-Textiles/v2/commit/7581cf09b06bc33af5f6a8673d86b850727aec5d))


### Features

* **Add inventory from the design now:** Add inventory from the design now ([307fc71](https://github.com/Jaal-Yantra-Textiles/v2/commit/307fc71c37dd0c62549d4b6fda915cde2ab91938))
* **2:** Jyt-AI for automating basic stuff choosing the Mastra.AI for all that relying on the OPEN AI for now ([b564de7](https://github.com/Jaal-Yantra-Textiles/v2/commit/b564de71ca4ad044d5e3270d2b4fc6c180358bd0))


### Tests

* **API tests:** API tests for the Inventory Linking Full Coverage done. ([feb406d](https://github.com/Jaal-Yantra-Textiles/v2/commit/feb406dc1504df08a752a15d499827dd41cf9706))


### BREAKING CHANGES

* **API tests:** API inventory

# [2.0.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v1.2.0...v2.0.0) (2025-02-16)


### Bug Fixes

* **Fixed Run Task Assignment with CI build upgrade to yarn:** Run Task Assignments with CI adopting to use the yarn feature instead of npm ([a092f82](https://github.com/Jaal-Yantra-Textiles/v2/commit/a092f824947259ea4fc61ea4c68ccad6bf9a7237))


### Features

* **Blog and Pages For Website Support:** I have added blog and custom JSON support for the blocks, now next is to add AI support on the UI to generate the blocks automatically ([35e44bd](https://github.com/Jaal-Yantra-Textiles/v2/commit/35e44bd48584f5998e071a9da3832133de44d3ea))
* **Pages and Blogs Data Table Feature:** Working on fixing the UI in websites with pages and blogs section ([8740ad6](https://github.com/Jaal-Yantra-Textiles/v2/commit/8740ad61153adbb0338cf138888ce3baf8bb4c0e))


### Tests

* Adding the test on the website public API ([1d0da0d](https://github.com/Jaal-Yantra-Textiles/v2/commit/1d0da0d87a5b71ccb4cffdeaad787526048d26b1))
* Fixed the API middleware condition for 400 and 404 ([1dd2976](https://github.com/Jaal-Yantra-Textiles/v2/commit/1dd2976776bce883fca3b64a15e925cc18afee22))


### BREAKING CHANGES

* Created new API website/domain/page
* API now returns the error and issues if validator error occurs
* **Blog and Pages For Website Support:** Upgrade to the medusa 2.5.0 so perform the migration
* **Fixed Run Task Assignment with CI build upgrade to yarn:**

# [1.2.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v1.1.0...v1.2.0) (2025-02-05)


### Features

* **test, fix:** Tasks can be claimed and finished through partners , next step web blocks and deployment ([b7f7bf1](https://github.com/Jaal-Yantra-Textiles/v2/commit/b7f7bf1ffd5014c2836c6f9dab3960a5c0fd0fdc))

# [1.1.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v1.0.0...v1.1.0) (2025-02-04)


### Bug Fixes

* design ui with hooks and tasks linking showing up in json ([afa877f](https://github.com/Jaal-Yantra-Textiles/v2/commit/afa877f7da78b558fd4947613f69cc8310add3ef))
* **Fixed the jest.timeout in one of the tests:** Fixing the jest time out is important for all the tests ([3c79953](https://github.com/Jaal-Yantra-Textiles/v2/commit/3c79953c9ab56f5619bd153cc20b288b95063919))


### Features

* **Tasks API:** Finished on the task dependency , where each task could have incoming and outgoing tasks, that would help us understand which task is dependent on which task. ([eee2f73](https://github.com/Jaal-Yantra-Textiles/v2/commit/eee2f7367b51e2f934a7b5a502fd3cf5b01d74e3))
* **Partners:** Workflow for partner creation with REST API ([8b76eb4](https://github.com/Jaal-Yantra-Textiles/v2/commit/8b76eb4c28c5023b117710893ef8a99f2797aebd))

# 1.0.0 (2025-01-25)


### Features

* implement full design system with UI components ([63923af](https://github.com/Jaal-Yantra-Textiles/v2/commit/63923af83a30dc5e791bd8aafe49152fcc63fe98))
