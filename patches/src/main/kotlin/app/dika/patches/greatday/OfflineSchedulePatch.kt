/* SPDX-License-Identifier: GPL-3.0-only */
package app.dika.patches.greatday

import app.morphe.patcher.patch.ApkFileType
import app.morphe.patcher.patch.AppTarget
import app.morphe.patcher.patch.Compatibility
import app.morphe.patcher.patch.bytecodePatch
import app.morphe.patcher.patch.resourcePatch
import app.morphe.patcher.extensions.InstructionExtensions.addInstructionsWithLabels
import app.morphe.patcher.extensions.InstructionExtensions.getInstruction
import app.morphe.patcher.util.proxy.mutableTypes.MutableAnnotation
import app.morphe.patcher.util.smali.ExternalLabel
import com.android.tools.smali.dexlib2.AccessFlags
import com.android.tools.smali.dexlib2.iface.value.ArrayEncodedValue
import com.android.tools.smali.dexlib2.iface.value.IntEncodedValue
import com.android.tools.smali.dexlib2.iface.value.StringEncodedValue
import com.android.tools.smali.dexlib2.immutable.ImmutableAnnotation
import com.android.tools.smali.dexlib2.immutable.ImmutableAnnotationElement
import com.android.tools.smali.dexlib2.immutable.value.ImmutableStringEncodedValue
import java.security.MessageDigest
import java.util.Properties
import org.w3c.dom.Element

// Explicit build mode: final releases must set this to false. Trial APKs hold
// all offline sends and expose only the diagnostics needed for device tests.
private const val TRIAL_BUILD = true

private const val PREVIEW_ANCHOR = "this.defaultTimeoutAtt=5}ngOnInit(){"
private const val OFFLINE_INIT = "ngOnInit(){this.params=this.navigationService.getParams()||this.navParams.get(\"params\")}"
private const val INDEX = "assets/public/index.html"
private const val CAPACITOR_CONFIG = "assets/capacitor.config.json"
private const val SHARED = "assets/public/61543.79fad183692bc090.js"
private const val MACHINE_ANCHOR = "this.livenessGestureStatus=!1}get googlePlayServicesAvailable(){"
private const val NAV_ANCHOR = "this.previousRouteData=\"\"}get previousRoute(){"
private const val SYNC_ANCHOR = "syncAttendanceOffline(w){var H=this;return(0,s.A)(function*(){try{if(H.stopSync||H.isSync)return;"

private val greatDayCompatibility = Compatibility(
    name = "GreatDay 8",
    packageName = "com.greatday.app",
    apkFileType = ApkFileType.APK,
    appIconColor = 0xFF7A00,
    targets = listOf(AppTarget(version = "1.79.1", isExperimental = true)),
)

// The supplied APK registers both the community plugin and Transistorsoft as
// BackgroundGeolocation. Give only the legacy community annotation a trial
// alias, preserving its real permissions, request code and implementation.
private const val COMMUNITY_LOCATION = "Lcom/equimaps/capacitor_background_geolocation/BackgroundGeolocation;"
private const val LEGACY_PLUGIN_ANNOTATION = "Lcom/greatday/app/c91;"
private const val COMMUNITY_LOCATION_ALIAS = "DikaBackgroundGeolocation"
private const val BACKGROUND_FETCH = "Lcom/transistorsoft/tsbackgroundfetch/BackgroundFetch;"
private const val BACKGROUND_TASK = "Lcom/transistorsoft/tsbackgroundfetch/BGTask;"
private const val BACKGROUND_CONFIG = "Lcom/transistorsoft/tsbackgroundfetch/BackgroundFetchConfig;"
private const val FETCH_CALLBACK = "Lcom/transistorsoft/tsbackgroundfetch/BackgroundFetch\$Callback;"

val greatDayTrialLocationAliasPatch = bytecodePatch {
    execute {
        if (TRIAL_BUILD) {
            var targetCount = 0
            classDefForEach { if (it.type == COMMUNITY_LOCATION) targetCount++ }
            check(targetCount == 1) { "Unsupported APK: community location class is missing or ambiguous" }
            val target = classDefBy(COMMUNITY_LOCATION)
            check(target.methods.count { it.name == "addWatcher" } == 1 &&
                target.methods.count { it.name == "removeWatcher" } == 1) {
                "Unsupported APK: community location methods changed"
            }
            val annotationType = classDefBy(LEGACY_PLUGIN_ANNOTATION)
            check(annotationType.methods.count {
                it.name == "name" && it.parameterTypes.isEmpty() && it.returnType == "Ljava/lang/String;"
            } == 1) { "Unsupported APK: legacy plugin annotation has no unique name property" }
            val annotation = target.annotations.singleOrNull { it.type == LEGACY_PLUGIN_ANNOTATION }
                ?: error("Unsupported APK: community plugin annotation is missing or ambiguous")
            val originalElements = annotation.elements.associate { it.name to it.value }
            check(originalElements.keys == setOf("permissionRequestCode", "permissions")) {
                "Unsupported APK: community plugin annotation elements changed"
            }
            check((originalElements["permissionRequestCode"] as? IntEncodedValue)?.value == 28351) {
                "Unsupported APK: community plugin request code changed"
            }
            val permissions = (originalElements["permissions"] as? ArrayEncodedValue)?.value
                ?.map { (it as? StringEncodedValue)?.value }
            check(permissions == listOf("android.permission.ACCESS_COARSE_LOCATION", "android.permission.ACCESS_FINE_LOCATION")) {
                "Unsupported APK: community plugin permissions changed"
            }
            val replacement = MutableAnnotation(ImmutableAnnotation(
                annotation.visibility,
                annotation.type,
                annotation.elements.toList() + ImmutableAnnotationElement(
                    "name", ImmutableStringEncodedValue(COMMUNITY_LOCATION_ALIAS),
                ),
            ))
            // Validate every declaration before obtaining a mutable proxy.
            val mutableTarget = mutableClassDefBy(target)
            val previous = mutableTarget.annotations.single { it.type == LEGACY_PLUGIN_ANNOTATION }
            check(mutableTarget.annotations.remove(previous)) { "Cannot replace community plugin annotation" }
            check(mutableTarget.annotations.add(replacement)) { "Cannot install community plugin alias" }
            check(replacement.elements.filter { it.name != "name" }.associate { it.name to it.value } == originalElements) {
                "Community plugin annotation values were not preserved"
            }

            // A live WebView can have the SDK's headless lifecycle flag set.
            // Dispatch only our explicitly configured trial tasks to its
            // registered callback; every other SDK task keeps the original flow.
            var fetchClassCount = 0
            classDefForEach { if (it.type == BACKGROUND_FETCH) fetchClassCount++ }
            check(fetchClassCount == 1) { "Unsupported APK: BackgroundFetch class is missing or ambiguous" }
            val fetch = classDefBy(BACKGROUND_FETCH)
            val dispatch = fetch.methods.singleOrNull {
                it.name == "doFetch" && it.parameterTypes.map(CharSequence::toString) == listOf(BACKGROUND_TASK) && it.returnType == "V"
            } ?: error("Unsupported APK: BackgroundFetch dispatch changed")
            check(!AccessFlags.STATIC.isSet(dispatch.accessFlags)) { "Unsupported APK: BackgroundFetch dispatch is static" }
            val implementation = dispatch.implementation ?: error("Unsupported APK: BackgroundFetch dispatch has no body")
            check(implementation.registerCount in 4..16 && implementation.instructions.iterator().hasNext()) {
                "Unsupported APK: BackgroundFetch dispatch has insufficient local registers"
            }
            val getConfig = fetch.methods.singleOrNull {
                it.name == "getConfig" && it.parameterTypes.map(CharSequence::toString) == listOf("Ljava/lang/String;") && it.returnType == BACKGROUND_CONFIG
            } ?: error("Unsupported APK: BackgroundFetch configuration lookup changed")
            check(!AccessFlags.STATIC.isSet(getConfig.accessFlags)) { "Unsupported APK: configuration lookup is static" }
            check(fetch.fields.count { it.name == "mFetchCallback" && it.type == FETCH_CALLBACK && !AccessFlags.STATIC.isSet(it.accessFlags) } == 1) {
                "Unsupported APK: BackgroundFetch callback field changed"
            }
            val callback = classDefBy(FETCH_CALLBACK)
            check(AccessFlags.INTERFACE.isSet(callback.accessFlags) && callback.methods.count {
                it.name == "onFetch" && it.parameterTypes.map(CharSequence::toString) == listOf("Ljava/lang/String;") && it.returnType == "V"
            } == 1) { "Unsupported APK: BackgroundFetch callback interface changed" }
            check(classDefBy(BACKGROUND_TASK).methods.count {
                it.name == "getTaskId" && it.parameterTypes.isEmpty() && it.returnType == "Ljava/lang/String;" &&
                    !AccessFlags.STATIC.isSet(it.accessFlags) && !AccessFlags.PRIVATE.isSet(it.accessFlags)
            } == 1) { "Unsupported APK: background task ID getter changed" }
            val lookupInvoke = if (AccessFlags.PRIVATE.isSet(getConfig.accessFlags)) "invoke-direct" else "invoke-virtual"
            val mutableDispatch = mutableClassDefBy(fetch).methods.single {
                it.name == dispatch.name && it.parameterTypes == dispatch.parameterTypes && it.returnType == dispatch.returnType
            }
            mutableDispatch.addInstructionsWithLabels(
                0,
                """
                    invoke-virtual {p1}, $BACKGROUND_TASK->getTaskId()Ljava/lang/String;
                    move-result-object v0
                    if-eqz v0, :dika_original_fetch
                    const-string v1, "dika-trial-offline-"
                    invoke-virtual {v0, v1}, Ljava/lang/String;->startsWith(Ljava/lang/String;)Z
                    move-result v1
                    if-eqz v1, :dika_original_fetch
                    $lookupInvoke {p0, v0}, $BACKGROUND_FETCH->getConfig(Ljava/lang/String;)$BACKGROUND_CONFIG
                    move-result-object v1
                    if-eqz v1, :dika_original_fetch
                    iget-object v1, p0, $BACKGROUND_FETCH->mFetchCallback:$FETCH_CALLBACK
                    if-eqz v1, :dika_original_fetch
                    invoke-interface {v1, v0}, $FETCH_CALLBACK->onFetch(Ljava/lang/String;)V
                    return-void
                """.trimIndent(),
                ExternalLabel("dika_original_fetch", mutableDispatch.getInstruction(0)),
            )
        }
    }
}

// All selected features share one validation/injection transaction.
// An unnamed dependency is hidden from the selectable patch list.
val greatDayIntegrationPatch = resourcePatch {
    if (TRIAL_BUILD) dependsOn(greatDayTrialLocationAliasPatch, greatDayNativeAttendancePatch)
    execute {
        fun resource(name: String): String = checkNotNull(
            object {}.javaClass.getResourceAsStream("/greatday8/$name")
        ) { "Missing bundled resource: $name" }.bufferedReader(Charsets.UTF_8).use { it.readText() }

        val fingerprints = Properties().apply { load(resource("targets.properties").reader()) }
        // Validate EVERYTHING before changing any asset. A version label alone
        // cannot identify this manually relabelled APK.
        for (path in fingerprints.stringPropertyNames()) {
            val file = get(path, true)
            check(file.isFile) { "Unsupported APK: missing $path" }
            val hash = MessageDigest.getInstance("SHA-256").digest(file.readBytes())
                .joinToString("") { "%02x".format(it.toInt() and 0xff) }
            check(hash == fingerprints.getProperty(path)) { "Unsupported APK content: $path. No files changed." }
        }
        val replacements = linkedMapOf<String, String>()
        fun exactlyOnce(text: String, anchor: String): Boolean {
            val first = text.indexOf(anchor)
            return first >= 0 && text.indexOf(anchor, first + anchor.length) < 0
        }
        for (path in fingerprints.stringPropertyNames().filter {
            it.endsWith(".js")
        }) {
            var content = get(path, true).readText()
            fun hook(anchor: String, replacement: String) {
                check(exactlyOnce(content, anchor)) { "Ambiguous hook: $path" }
                content = content.replace(anchor, replacement)
            }
            if (path == SHARED) {
                hook(MACHINE_ANCHOR, "this.livenessGestureStatus=!1;globalThis.DikaOffline?.attachMachine(this);}get googlePlayServicesAvailable(){")
                if (TRIAL_BUILD) hook("getCurrentTime(){return new Promise(X=>{var J;this.attendanceApi.getCurrentTime()",
                    "getCurrentTime(){if(globalThis.DikaOffline?.backgroundRunner?.useOfflineDeviceTime(this))return Promise.resolve((new Date).toISOString());return new Promise(X=>{var J;this.attendanceApi.getCurrentTime()")
                hook(NAV_ANCHOR, "this.previousRouteData=\"\";globalThis.DikaOffline?.attachNavigation(this);}get previousRoute(){")
                hook("this.resultSyncOffline$=new i.Subject}get isSync(){", "this.resultSyncOffline$=new i.Subject;globalThis.DikaOffline?.attachSync(this);}get isSync(){")
                hook("J.hideMap||null!=X&&X.isAttendanceBarcode&&J.networkService.isOffline||J.networkService.isOffline", "globalThis.DikaOffline?.requiresLocation(J)||J.hideMap||null!=X&&X.isAttendanceBarcode&&J.networkService.isOffline||J.networkService.isOffline")
                val sendGuard = if (TRIAL_BUILD) "globalThis.DikaOffline?.syncGate(w,H);return;" else
                    "if(globalThis.DikaOffline&&globalThis.DikaOffline.syncGate(w,H)===false)return;"
                hook(SYNC_ANCHOR, SYNC_ANCHOR + sendGuard)
            } else {
                hook(PREVIEW_ANCHOR, "${PREVIEW_ANCHOR}globalThis.DikaOffline?.attachPreview(this);")
            }
            if (path != SHARED && !path.contains("86035.")) {
                hook(OFFLINE_INIT, OFFLINE_INIT.dropLast(1) + ";globalThis.DikaOffline?.attachOffline(this);}")
                val (argument, receiver, record) = if (path.contains("19123."))
                    Triple("f", "v", "b") else Triple("m", "d", "E")
                val method = "recordAttendance($argument){var $receiver=this;"
                hook(method, "recordAttendance($argument){const __dikaTicket=globalThis.DikaOffline?.ticketFor(this);var $receiver=this;")
                val captured = "$record.attOn=\"offline\",$receiver.navigationService.pushSide("
                hook(captured, "$record.attOn=\"offline\",globalThis.DikaOffline?.captured(__dikaTicket,$record),$receiver.navigationService.pushSide(")
            }
            replacements[path] = content
        }
        val html = get(INDEX, true).readText()
        check(exactlyOnce(html, "</head>")) { "Unsupported index document" }
        replacements[INDEX] = html.replace("</head>",
            "<script src=\"dika/features.js\"></script><script src=\"dika/core.js\"></script><script src=\"dika/runtime.js\"></script><script src=\"dika/background.js\"></script><script src=\"dika/native.js\"></script><script src=\"dika/ui.js\"></script></head>")
        if (TRIAL_BUILD) {
            // The exact original JSON was fingerprinted above. Keep every
            // existing setting and select Capacitor's shipped legacy callback
            // transport, which uses evaluateJavascript instead of ReplyProxy.
            val nativeConfigText = get(CAPACITOR_CONFIG, true).readText()
            val rootEnd = nativeConfigText.lastIndexOf('}')
            check(rootEnd >= 0 && nativeConfigText.substring(rootEnd + 1).isBlank() &&
                !nativeConfigText.contains("\"android\"")) { "Unsupported Capacitor configuration" }
            replacements[CAPACITOR_CONFIG] = nativeConfigText.substring(0, rootEnd) +
                ",\"android\":{\"useLegacyBridge\":true}" + nativeConfigText.substring(rootEnd)
        }
        // Read all bundled code before applying the transformation.
        val core = resource("core.js")
        val runtime = resource("runtime.js")
        val background = resource("background.js")
        val native = resource("native.js")
        val ui = resource("ui.js")
        if (TRIAL_BUILD) {
            document("AndroidManifest.xml").use { manifest ->
                installNativeAttendanceManifest(manifest)
                val applications = manifest.getElementsByTagName("application")
                check(applications.length == 1) { "Unsupported manifest: expected one application" }
                (applications.item(0) as Element).setAttributeNS(
                    "http://schemas.android.com/apk/res/android", "android:debuggable", "true",
                )
            }
        }
        get("assets/public/dika/features.js", false).apply {
            parentFile.mkdirs()
            writeText("globalThis.DikaFeatures={scheduler:false,reminders:false,sendGate:false,diagnostics:false,trial:$TRIAL_BUILD,nativeTrial:$TRIAL_BUILD,backgroundFetchVerifiedUnused:false,backgroundKeeper:false};")
        }
        get("assets/public/dika/core.js", false).apply { parentFile.mkdirs(); writeText(core) }
        get("assets/public/dika/runtime.js", false).apply { parentFile.mkdirs(); writeText(runtime) }
        get("assets/public/dika/background.js", false).apply { parentFile.mkdirs(); writeText(background) }
        get("assets/public/dika/native.js", false).apply { parentFile.mkdirs(); writeText(native) }
        get("assets/public/dika/ui.js", false).apply { parentFile.mkdirs(); writeText(ui) }
        replacements.forEach { (path, content) -> get(path, true).writeText(content) }
    }
}

private fun featurePatch(name: String, description: String, flag: String, selected: Boolean) = resourcePatch(
    name = name,
    description = description,
    default = selected,
) {
    compatibleWith(greatDayCompatibility)
    dependsOn(greatDayIntegrationPatch)
    execute {
        val file = get("assets/public/dika/features.js", true)
        val content = file.readText()
        val anchor = "$flag:false"
        check(content.indexOf(anchor) >= 0 && content.indexOf(anchor) == content.lastIndexOf(anchor)) { "Invalid feature configuration: $flag" }
        file.writeText(content.replace(anchor, "$flag:true"))
    }
}

@Suppress("unused")
val offlineSchedulePatch = featurePatch(
    "Absen terjadwal", "Uji alarm native WITA dan lokasi sementara; hook GreatDay belum terhubung. Pengiriman ditahan.", "scheduler", true,
)
@Suppress("unused")
val attendanceReminderPatch = featurePatch(
    "Pengingat absen", "Notifikasi sesuai jadwal masuk dan pulang.", "reminders", true,
)
@Suppress("unused")
val confirmOfflineSendPatch = featurePatch(
    "Konfirmasi sebelum kirim", "Tahan pengiriman absensi offline sampai disetujui.", "sendGate", false,
)
@Suppress("unused")
val attendanceDiagnosticsPatch = featurePatch(
    "Diagnostik", "Tampilkan rincian pemeriksaan dan ekspor log.", "diagnostics", false,
)
