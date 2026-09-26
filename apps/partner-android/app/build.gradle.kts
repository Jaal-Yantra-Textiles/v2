import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

// Release signing is property-driven (gradle.properties, ~/.gradle/gradle.properties
// or -P on the command line — never committed):
//   JYT_PARTNER_STORE_FILE, JYT_PARTNER_STORE_PASSWORD,
//   JYT_PARTNER_KEY_ALIAS,   JYT_PARTNER_KEY_PASSWORD
// Without them, bundleRelease produces an unsigned bundle (safe default).
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "com.jyt.partner"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.jyt.partner"
        minSdk = 26
        targetSdk = 36
        versionCode = 2
        versionName = "0.1.1"

        // The backend the app talks to. The Android emulator reaches the
        // host's localhost through 10.0.2.2 — the counterpart of the iOS
        // app's Info.plist PartnerBackendURL override. A PLAY RELEASE MUST
        // override this with the https production URL, e.g.:
        //   ./gradlew bundleRelease -PpartnerBackendUrl=https://api.example.com
        buildConfigField(
            "String",
            "BACKEND_URL",
            "\"${project.findProperty("partnerBackendUrl") ?: "http://10.0.2.2:9000"}\""
        )
    }

    signingConfigs {
        if (keystoreProps.isNotEmpty()) {
            create("release") {
                storeFile = rootProject.file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release")
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    lint {
        // Pure-Compose app — no fragments anywhere. The activity-result
        // lint check misfires on ComponentActivity without a Fragment
        // dependency on the classpath.
        disable += "InvalidFragmentVersionForActivityResult"
    }

    testOptions {
        unitTests {
            // android.util.Log in plain JVM tests (PartnerApi logs decode
            // failures) returns defaults instead of throwing.
            isReturnDefaultValues = true
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.09.03")
    implementation(composeBom)

    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.navigation:navigation-compose:2.8.2")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.6")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.6")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("io.coil-kt:coil-compose:2.7.0")
    // FCM — deliberately WITHOUT the google-services plugin: the build must
    // succeed without google-services.json, and push degrades to a no-op
    // (guarded init) until one is dropped in.
    implementation("com.google.firebase:firebase-messaging:24.0.2")
    implementation("androidx.core:core-ktx:1.13.1")
    // System splash (API 31+) with the pre-31 backport, held on screen
    // while the stored session restores.
    implementation("androidx.core:core-splashscreen:1.0.1")

    debugImplementation("androidx.compose.ui:ui-tooling")

    // JVM integration tests — the whole client (OkHttp + serialization +
    // auth + multipart) against a local MockWebServer, no emulator.
    testImplementation("junit:junit:4.13.2")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
}
