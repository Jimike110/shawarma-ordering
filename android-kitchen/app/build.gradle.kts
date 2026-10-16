plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }

val kitchenOrigin = providers.gradleProperty("kitchenOrigin").orElse("https://example.invalid").get()
require(Regex("https://[a-zA-Z0-9.-]+(?::[0-9]+)?").matches(kitchenOrigin)) { "kitchenOrigin must be one HTTPS origin without a path" }
val signingPath = System.getenv("KITCHEN_KEYSTORE_FILE")
val signingPasswordPath = System.getenv("KITCHEN_KEYSTORE_PASSWORD_FILE")
android {
    namespace = "ru.yasha.kitchen"
    compileSdk = 36
    buildToolsVersion = "36.0.0"
    defaultConfig {
        applicationId = "ru.yasha.kitchen"
        minSdk = 26
        targetSdk = 36
        versionCode = providers.gradleProperty("appVersionCode").orElse("2").get().toInt()
        versionName = providers.gradleProperty("appVersionName").orElse("1.0.1").get()
        buildConfigField("String", "KITCHEN_ORIGIN", "\"$kitchenOrigin\"")
    }
    buildFeatures { buildConfig = true }
    signingConfigs {
        if (!signingPath.isNullOrBlank() && !signingPasswordPath.isNullOrBlank()) create("trial") {
            storeFile = file(signingPath)
            storePassword = file(signingPasswordPath).readText().trim()
            keyAlias = "kitchen"
            keyPassword = storePassword
        }
    }
    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
            if (signingConfigs.findByName("trial") != null) signingConfig = signingConfigs.getByName("trial")
        }
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    sourceSets.getByName("main").res.srcDir(layout.buildDirectory.dir("generated/kitchenAudio"))
}
val copyKitchenAudio by tasks.registering(Copy::class) {
    from(rootProject.file("../public/audio/new-order-313025.mp3"))
    into(layout.buildDirectory.dir("generated/kitchenAudio/raw"))
    rename { "new_order.mp3" }
}
tasks.named("preBuild") { dependsOn(copyKitchenAudio) }
dependencies {
    implementation("androidx.activity:activity:1.10.1")
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
    testImplementation("junit:junit:4.13.2")
}
