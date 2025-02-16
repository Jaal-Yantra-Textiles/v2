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
