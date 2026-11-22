import java.net.URLClassLoader
import java.util.Properties

dependencies {
    testImplementation("app.morphe:morphe-patcher:2.2.0")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.10.2")
}

// Compile a dependency-free Android runtime separately from the patcher's JVM code.
// The generated raw DEX is merged by extendWith(), never loaded by the patch JVM.
val nativeSdk = providers.environmentVariable("ANDROID_HOME")
    .orElse(providers.environmentVariable("ANDROID_SDK_ROOT"))
    .orElse(providers.provider {
        val local = rootProject.file("local.properties")
        if (local.isFile) Properties().apply { local.inputStream().use { load(it) } }.getProperty("sdk.dir")
        else "${System.getProperty("user.home")}/AppData/Local/Android/Sdk"
    })
val androidJar = nativeSdk.map { file("$it/platforms/android-36/android.jar") }
val d8Jar = nativeSdk.map { file("$it/build-tools/36.0.0/lib/d8.jar") }
val nativeClasses = layout.buildDirectory.dir("native/classes")
val compileNativeAttendance = tasks.register<JavaCompile>("compileNativeAttendance") {
    source(rootProject.fileTree("native-runtime/src/main/java") { include("**/*.java") })
    classpath = files(androidJar)
    destinationDirectory.set(nativeClasses)
    options.release.set(8)
    options.encoding = "UTF-8"
}
val nativeAttendanceJar = tasks.register<Jar>("nativeAttendanceJar") {
    dependsOn(compileNativeAttendance)
    from(nativeClasses)
    archiveFileName.set("native-attendance.jar")
    destinationDirectory.set(layout.buildDirectory.dir("native"))
}
val dexNativeAttendance = tasks.register<JavaExec>("dexNativeAttendance") {
    dependsOn(nativeAttendanceJar)
    classpath = files(d8Jar)
    mainClass.set("com.android.tools.r8.D8")
    val dexDir = layout.buildDirectory.dir("native/dex")
    inputs.file(nativeAttendanceJar.flatMap { it.archiveFile })
    inputs.file(androidJar)
    inputs.file(d8Jar)
    outputs.dir(dexDir)
    doFirst {
        dexDir.get().asFile.mkdirs()
        args("--release", "--min-api", "26", "--lib", androidJar.get().absolutePath,
            "--output", dexDir.get().asFile.absolutePath, nativeAttendanceJar.get().archiveFile.get().asFile.absolutePath)
    }
}
val packageNativeAttendance = tasks.register<Copy>("packageNativeAttendance") {
    dependsOn(dexNativeAttendance)
    from(layout.buildDirectory.file("native/dex/classes.dex")) { rename { "native-attendance.mpe" } }
    into(layout.buildDirectory.dir("generated/nativeResources/greatday8"))
}
tasks.named<ProcessResources>("processResources") {
    dependsOn(packageNativeAttendance)
    from(layout.buildDirectory.dir("generated/nativeResources"))
}

val compileNativePlanTests = tasks.register<JavaCompile>("compileNativePlanTests") {
    source(rootProject.file("native-runtime/src/main/java/app/dika/greatday/nativebridge/SchedulePlan.java"),
        rootProject.file("native-runtime/src/main/java/app/dika/greatday/nativebridge/GreatDayOfflineHook.java"),
        rootProject.fileTree("native-runtime/src/test/java") { include("**/SchedulePlanTest.java") })
    classpath = files()
    destinationDirectory.set(layout.buildDirectory.dir("native/testClasses"))
    options.release.set(8)
    options.encoding = "UTF-8"
}
tasks.register<JavaExec>("testNativePlan") {
    dependsOn(compileNativePlanTests)
    classpath = files(compileNativePlanTests.flatMap { it.destinationDirectory })
    mainClass.set("app.dika.greatday.nativebridge.SchedulePlanTest")
}

// Optional read-only-to-device integration check against the exact local original APK.
tasks.register<JavaExec>("verifyNativeTarget") {
    dependsOn("testClasses")
    classpath = sourceSets["test"].runtimeClasspath
    mainClass.set("app.dika.patches.greatday.VerifyNativeTargetKt")
    maxHeapSize = "3g"
    doFirst {
        val apk = providers.gradleProperty("targetApk").orNull ?: error("Supply -PtargetApk=/path/to/original.apk")
        val output = layout.buildDirectory.dir("native-target-check").get().asFile.canonicalFile
        check(output.toPath().startsWith(rootProject.projectDir.canonicalFile.toPath()))
        args(file(apk).canonicalPath, output.path)
    }
}

group = "app.dika"

patches {
    about {
        name = "Dika GreatDay 8 patches"
        description = "Absen otomatis, pengingat, dan pengaturan GreatDay"
        source = "https://github.com/andikapramudya-project/dika-morphe-patches"
        author = "andikapramudyadika"
        contact = "https://github.com/andikapramudya-project/dika-morphe-patches/issues"
        website = "https://github.com/andikapramudya-project/dika-morphe-patches"
        license = "GPLv3"
    }
}

// Verify the compiled patch declarations, including the hidden shared dependency.
tasks.register("verifyPatchChoices") {
    dependsOn("classes")
    doLast {
        val paths = configurations.getByName("runtimeClasspath").files +
            layout.buildDirectory.dir("classes/kotlin/main").get().asFile +
            layout.buildDirectory.dir("resources/main").get().asFile
        URLClassLoader(paths.map { it.toURI().toURL() }.toTypedArray(), javaClass.classLoader).use { loader ->
            val declarations = loader.loadClass("app.dika.patches.greatday.OfflineSchedulePatchKt")
            val getters = listOf("getOfflineSchedulePatch", "getAttendanceReminderPatch", "getConfirmOfflineSendPatch", "getAttendanceDiagnosticsPatch")
            val expected = listOf("Absen terjadwal", "Pengingat absen", "Konfirmasi sebelum kirim", "Diagnostik")
            val shared = declarations.getMethod("getGreatDayIntegrationPatch").invoke(null)
            check(shared.javaClass.getMethod("getName").invoke(shared) == null)
            val alias = declarations.getMethod("getGreatDayTrialLocationAliasPatch").invoke(null)
            check(alias.javaClass.getMethod("getName").invoke(alias) == null)
            val sharedDependencies = shared.javaClass.getMethod("getDependencies").invoke(shared) as Set<*>
            val native = loader.loadClass("app.dika.patches.greatday.NativeAttendancePatchKt")
                .getMethod("getGreatDayNativeAttendancePatch").invoke(null)
            check(sharedDependencies == if (project.version.toString().contains("trial")) setOf(alias, native) else emptySet<Any>()) {
                "Trial location alias dependency does not match the build version"
            }
            logger.lifecycle("PASS hidden trial location alias declaration and dependency")
            getters.forEachIndexed { index, getter ->
                val patch = declarations.getMethod(getter).invoke(null)
                check(patch.javaClass.getMethod("getName").invoke(patch) == expected[index])
                check(patch.javaClass.getMethod("getDefault").invoke(patch) == (index < 2))
                val dependencies = patch.javaClass.getMethod("getDependencies").invoke(patch) as Set<*>
                check(dependencies == setOf(shared))
                logger.lifecycle("PASS patch choice: {} (default={})", expected[index], index < 2)
            }
        }
    }
}
