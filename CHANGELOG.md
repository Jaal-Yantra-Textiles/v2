<<<<<<< HEAD
=======
# [5.9.0](https://github.com/Jaal-Yantra-Textiles/v2/compare/v5.8.0...v5.9.0) (2025-06-18)


### Features

* **Payment:** Stripe Payment Update ([2b5d084](https://github.com/Jaal-Yantra-Textiles/v2/commit/2b5d084115785ba63baf659b10a36e253c3087ea))

>>>>>>> 2949d584e28d2f31b51d3f2daae13f6a58c082c1
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
