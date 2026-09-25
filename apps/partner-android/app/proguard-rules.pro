# Keep kotlinx-serialization generated serializers (obfuscation-safe by
# default, but explicit for the API models).
-keepclassmembers class com.jyt.partner.** {
    *** Companion;
}
-keepclasseswithmembers class com.jyt.partner.** {
    kotlinx.serialization.KGeneratedSerializer* *;
}
