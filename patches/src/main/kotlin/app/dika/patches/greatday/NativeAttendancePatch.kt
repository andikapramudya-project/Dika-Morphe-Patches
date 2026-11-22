/* SPDX-License-Identifier: GPL-3.0-only */
package app.dika.patches.greatday

import app.morphe.patcher.patch.bytecodePatch
import org.w3c.dom.Document
import org.w3c.dom.Element
import javax.xml.parsers.DocumentBuilderFactory

val greatDayNativeAttendancePatch = bytecodePatch {
    extendWith("greatday8/native-attendance.mpe")
    execute {
        // Fail before packaging if the extension was not merged correctly.
        listOf("NativeInitProvider", "AttendanceAlarmReceiver", "BootReceiver", "AttendanceForegroundService",
            "NativePermissionActivity", "GreatDayOfflineHook").forEach {
            classDefBy("Lapp/dika/greatday/nativebridge/$it;")
        }
    }
}

internal fun installNativeAttendanceManifest(manifest: Document) {
    val android = "http://schemas.android.com/apk/res/android"
    val template = checkNotNull(object {}.javaClass.getResourceAsStream("/greatday8/native-manifest.xml"))
        .use { stream -> DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }
            .newDocumentBuilder().parse(stream) }
    val root = manifest.documentElement
    val application = manifest.getElementsByTagName("application").let {
        check(it.length == 1) { "Unsupported manifest application count" }; it.item(0) as Element
    }
    // The runtime uses platform WebMessagePort (API 23), notification APIs and Java APIs from API 26.
    val sdk = manifest.getElementsByTagName("uses-sdk").let {
        if (it.length == 0) manifest.createElement("uses-sdk").also { node -> root.insertBefore(node, application) }
        else it.item(0) as Element
    }
    val min = sdk.getAttributeNS(android, "minSdkVersion").ifEmpty { "1" }.toIntOrNull()
        ?: error("Unsupported minSdkVersion")
    if (min < 26) sdk.setAttributeNS(android, "android:minSdkVersion", "26")
    val permissions = template.getElementsByTagName("uses-permission")
    for (i in 0 until permissions.length) {
        val permission = permissions.item(i) as Element
        val name = permission.getAttributeNS(android, "name")
        val existing = manifest.getElementsByTagName("uses-permission")
        val match = (0 until existing.length).map { existing.item(it) as Element }
            .filter { it.getAttributeNS(android, "name") == name }
        check(match.size <= 1) { "Duplicate permission: $name" }
        if (match.isEmpty()) root.insertBefore(manifest.importNode(permission, true), application)
        else if (name == "android.permission.SCHEDULE_EXACT_ALARM") {
            // The supplied APK limits this permission to API 33. Native exact alarms on
            // Android 14+ need the same special access without that obsolete cap.
            match.single().removeAttributeNS(android, "maxSdkVersion")
        } else check(!match.single().hasAttributeNS(android, "maxSdkVersion")) { "Permission has limited SDK range: $name" }
    }
    val components = template.getElementsByTagName("application").item(0).childNodes
    for (i in 0 until components.length) {
        val component = components.item(i) as? Element ?: continue
        val name = component.getAttributeNS(android, "name")
        val existing = application.getElementsByTagName(component.tagName)
        check((0 until existing.length).none { (existing.item(it) as Element).getAttributeNS(android, "name") == name }) {
            "Native component already exists: $name"
        }
        application.appendChild(manifest.importNode(component, true))
    }
}
