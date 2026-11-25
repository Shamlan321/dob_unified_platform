package com.kakaonotilistener.kakaodump.crypto

import android.util.Base64
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

object KakaoDecrypt {
    private val keyCache = mutableMapOf<String, ByteArray>()

    // Reimplementation of com.kakao.talk.dream.Projector.incept() from libdream.so
    private val dict1 = listOf(
        "adrp.ldrsh.ldnp","ldpsw","umax","stnp.rsubhn","sqdmlsl","uqrshl.csel","sqshlu",
        "umin.usubl.umlsl","cbnz.adds","tbnz","usubl2","stxr","sbfx","strh","stxrb.adcs",
        "stxrh","ands.urhadd","subs","sbcs","fnmadd.ldxrb.saddl","stur","ldrsb","strb",
        "prfm","ubfiz","ldrsw.madd.msub.sturb.ldursb","ldrb","b.eq","ldur.sbfiz","extr",
        "fmadd","uqadd","sshr.uzp1.sttrb","umlsl2","rsubhn2.ldrh.uqsub","uqshl","uabd",
        "ursra","usubw","uaddl2","b.gt","b.lt","sqshl","bics","smin.ubfx","smlsl2",
        "uabdl2","zip2.ssubw2","ccmp","sqdmlal","b.al","smax.ldurh.uhsub","fcvtxn2","b.pl"
    )
    private val dict2 = listOf(
        "saddl","urhadd","ubfiz.sqdmlsl.tbnz.stnp","smin","strh","ccmp","usubl","umlsl",
        "uzp1","sbfx","b.eq","zip2.prfm.strb","msub","b.pl","csel","stxrh.ldxrb",
        "uqrshl.ldrh","cbnz","ursra","sshr.ubfx.ldur.ldnp","fcvtxn2","usubl2","uaddl2",
        "b.al","ssubw2","umax","b.lt","adrp.sturb","extr","uqshl","smax","uqsub.sqshlu",
        "ands","madd","umin","b.gt","uabdl2","ldrsb.ldpsw.rsubhn","uqadd","sttrb","stxr",
        "adds","rsubhn2.umlsl2","sbcs.fmadd","usubw","sqshl","stur.ldrsh.smlsl2","ldrsw",
        "fnmadd","stxrb.sbfiz","adcs","bics.ldrb","l1ursb","subs.uhsub","ldurh","uabd","sqdmlal"
    )

    private fun incept(n: Int): String {
        val word1 = dict1[n % dict1.size]
        val word2 = dict2[(n + 31) % dict2.size]
        return "$word1.$word2"
    }

    private val prefixes: List<String> by lazy {
        listOf(
            "", "", "12", "24", "18", "30", "36", "12", "48", "7", "35", "40", "17", "23", "29",
            "isabel", "kale", "sulli", "van", "merry", "kyle", "james", "maddux",
            "tony", "hayden", "paul", "elijah", "dorothy", "sally", "bran",
            incept(830819), "veil"
        )
    }

    private fun genSalt(userId: Long, encType: Int): ByteArray {
        if (userId <= 0) return ByteArray(16)
        if (encType < 0 || encType >= prefixes.size) {
            throw IllegalArgumentException("Unsupported encoding type $encType")
        }
        var salt = prefixes[encType] + userId.toString()
        if (salt.length > 16) salt = salt.substring(0, 16)
        salt = salt.padEnd(16, '\u0000')
        return salt.toByteArray(Charsets.UTF_8)
    }

    private fun pkcs16adjust(a: IntArray, aOff: Int, b: IntArray) {
        var x = (b[b.size - 1] and 0xff) + (a[aOff + b.size - 1] and 0xff) + 1
        a[aOff + b.size - 1] = x % 256
        x = x shr 8
        for (i in b.size - 2 downTo 0) {
            x += (b[i] and 0xff) + (a[aOff + i] and 0xff)
            a[aOff + i] = x % 256
            x = x shr 8
        }
    }

    // PKCS12 key derivation, Bouncy Castle style (SHA-1), ported line-for-line
    // from kakaodecrypt.py's deriveKey(). Do not alter.
    private fun deriveKey(password: ByteArray, salt: ByteArray, iterations: Int, dkeySize: Int): ByteArray {
        val withNull = password + byteArrayOf(0)
        val passwordUtf16be = ByteArray(withNull.size * 2)
        for (i in withNull.indices) {
            passwordUtf16be[i * 2] = 0
            passwordUtf16be[i * 2 + 1] = withNull[i]
        }

        val v = 64 // SHA-1 block size
        val u = 20 // SHA-1 digest size

        val D = IntArray(v) { 1 }
        val S = IntArray(v * ((salt.size + v - 1) / v))
        for (i in S.indices) S[i] = salt[i % salt.size].toInt() and 0xff
        val P = IntArray(v * ((passwordUtf16be.size + v - 1) / v))
        for (i in P.indices) P[i] = passwordUtf16be[i % passwordUtf16be.size].toInt() and 0xff

        val I = (S + P)
        val B = IntArray(v)
        val c = (dkeySize + u - 1) / u
        val dKey = ByteArray(dkeySize)

        for (i in 1..c) {
            var md = MessageDigest.getInstance("SHA-1")
            md.update(D.map { it.toByte() }.toByteArray())
            md.update(I.map { it.toByte() }.toByteArray())
            var A = md.digest()

            for (j in 1 until iterations) {
                md = MessageDigest.getInstance("SHA-1")
                A = md.digest(A)
            }

            val Aint = A.map { it.toInt() and 0xff }
            for (j in B.indices) B[j] = Aint[j % Aint.size]

            for (j in 0 until (I.size / v)) {
                pkcs16adjust(I, j * v, B)
            }

            val start = (i - 1) * u
            if (i == c) {
                A.copyOfRange(0, dkeySize - start).copyInto(dKey, start)
            } else {
                A.copyInto(dKey, start)
            }
        }
        return dKey
    }

    fun decrypt(userId: Long, encType: Int, b64Ciphertext: String): String {
        val baseKey = byteArrayOf(
            0x16, 0x08, 0x09, 0x6f, 0x02, 0x17, 0x2b, 0x08,
            0x21, 0x21, 0x0a, 0x10, 0x03, 0x03, 0x07, 0x06
        )
        val iv = byteArrayOf(
            0x0f, 0x08, 0x01, 0x00, 0x19, 0x47, 0x25, 0xdc.toByte(),
            0x15, 0xf5.toByte(), 0x17, 0xe0.toByte(), 0xe1.toByte(),
            0x15, 0x0c, 0x35
        )

        val salt = genSalt(userId, encType)
        val cacheKey = salt.joinToString(",")
        val key = keyCache.getOrPut(cacheKey) { deriveKey(baseKey, salt, 2, 32) }

        val ciphertext = Base64.decode(b64Ciphertext, Base64.DEFAULT)
        if (ciphertext.isEmpty()) return b64Ciphertext

        val cipher = Cipher.getInstance("AES/CBC/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), IvParameterSpec(iv))
        val padded = cipher.doFinal(ciphertext)

        val padLen = padded.last().toInt() and 0xff
        if (padLen <= 0 || padLen > padded.size) {
            throw IllegalStateException("Unable to decrypt data")
        }
        val plaintext = padded.copyOfRange(0, padded.size - padLen)

        return try {
            String(plaintext, Charsets.UTF_8)
        } catch (e: Exception) {
            String(plaintext, Charsets.ISO_8859_1)
        }
    }
}
