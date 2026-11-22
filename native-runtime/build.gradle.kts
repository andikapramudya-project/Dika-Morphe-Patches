plugins { id("com.android.library") version "9.1.0" }
android {
    namespace = "app.dika.greatday.nativebridge"
    compileSdk = 36
    defaultConfig { minSdk = 26 }
    sourceSets {
        getByName("main").manifest.srcFile("../patches/src/main/resources/greatday8/native-manifest.xml")
        getByName("main").assets.srcDir("src/robolectric/assets")
        getByName("test").java.srcDir("src/robolectric/java")
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    testOptions.unitTests.isIncludeAndroidResources = true
}
dependencies {
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.17")
}
tasks.withType<Test>().configureEach {
    jvmArgs("--add-exports=java.base/jdk.internal.access=ALL-UNNAMED", "--add-opens=java.base/java.io=ALL-UNNAMED")
    include("**/NativeRuntimeTest.class")
    systemProperty("robolectric.dependency.repo.url", "https://repo.maven.apache.org/maven2")
    maxHeapSize = "2g"
    testLogging { events("passed", "failed", "skipped"); exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL }
}
