/* SPDX-License-Identifier: GPL-3.0-only */
package app.dika.patches.greatday

import app.morphe.patcher.Patcher
import app.morphe.patcher.PatcherConfig
import kotlinx.coroutines.runBlocking
import java.io.File
import java.util.zip.ZipFile

/** Applies the actual patches to a local APK without signing, installing or sending anything. */
fun main(args: Array<String>) = runBlocking {
    require(args.size == 2) { "Expected original APK and build output directory" }
    val apk = File(args[0]).canonicalFile
    val output = File(args[1]).canonicalFile
    require(apk.isFile && output != apk.parentFile)
    output.mkdirs()
    Patcher(PatcherConfig(apk, output.resolve("temporary"), validate = true)).use { patcher ->
        patcher += setOf(offlineSchedulePatch, attendanceReminderPatch, attendanceDiagnosticsPatch, confirmOfflineSendPatch)
        patcher().collect { result -> result.exception?.let { throw it } }
        // The native dependency validates all required merged class definitions during execute.
        patcher.writeApk(output.resolve("greatday-native-trial-unsigned.apk"))
    }
    ZipFile(output.resolve("greatday-native-trial-unsigned.apk")).use { zip ->
        fun text(path: String) = zip.getInputStream(checkNotNull(zip.getEntry(path))).bufferedReader().use { it.readText() }
        check("nativeTrial:true" in text("assets/public/dika/features.js"))
        check("backgroundKeeper:false" in text("assets/public/dika/features.js"))
        check("<script src=\"dika/native.js\"></script>" in text("assets/public/index.html"))
        check("globalThis.DikaOffline?.syncGate(w,H);return;" in text("assets/public/61543.79fad183692bc090.js"))
        check(zip.entries().asSequence().any { it.name.matches(Regex("classes[0-9]*\\.dex")) })
    }
    println("PASS actual APK patch application, native DEX merge, assets and unconditional offline send hold")
}
