import com.aloud.tts.AloudCommand
import com.aloud.tts.Highlight
import com.aloud.tts.toSnapshot
import java.io.File
import org.json.JSONObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The Kotlin end of the shared-fixture contract — the mirror of
 * `ios/ContractTests/AloudContractTests.swift`.
 *
 * `contracts/README.md` used to claim all four bindings asserted against the
 * same fixture bytes. In reality only TypeScript did (Rust restated them as
 * hardcoded literals — fixed in #29; Swift got a real test in #37). Kotlin was
 * the last binding kept in step by review alone, and it is one of the two where
 * a decode mismatch is a runtime crash on a device rather than a failed
 * compile.
 *
 * These read the SAME `contracts/fixtures.json` the Rust, TypeScript and Swift
 * suites read, located by walking up from this source file — no binding copies
 * the values.
 */
class AloudContractTest {

    private val fixtures: JSONObject by lazy {
        // contract-tests/src/test/kotlin -> ... -> repo root
        val here = File(System.getProperty("user.dir"))
        val root = generateSequence(here) { it.parentFile }
            .firstOrNull { File(it, "contracts/fixtures.json").exists() }
        assertNotNull(root, "could not locate contracts/fixtures.json above ${here.absolutePath}")
        JSONObject(File(root, "contracts/fixtures.json").readText())
    }

    private fun cases(): List<JSONObject> {
        val arr = fixtures.getJSONArray("cases")
        return (0 until arr.length()).map { arr.getJSONObject(it) }
    }

    private fun case(name: String): JSONObject =
        cases().firstOrNull { it.getString("name") == name }
            ?: error("fixture `$name` is missing")

    @Test
    fun `fixtures are loadable and non-empty`() {
        assertTrue(fixtures.getString("document").isNotEmpty())
        assertTrue(cases().isNotEmpty(), "fixtures.json declares no cases")
    }

    @Test
    fun `every snapshot fixture decodes into the Kotlin data class`() {
        var decoded = 0
        for (testCase in cases()) {
            val expected = testCase.optJSONObject("expect") ?: continue
            decoded++
            val name = testCase.getString("name")
            val snapshot = expected.toSnapshot()

            assertTrue(snapshot.status.isNotEmpty(), "$name: empty status")
            assertTrue(snapshot.unit >= 0, "$name: unit")
            assertTrue(snapshot.unitCount > 0, "$name: unitCount")
            assertTrue(snapshot.token >= 0, "$name: token")
            snapshot.highlight?.let {
                assertTrue(it.start < it.end, "$name: highlight is empty or inverted")
            }
        }
        assertTrue(decoded > 0, "no fixture carried an `expect` snapshot")
    }

    @Test
    fun `the play fixture decodes to the expected values`() {
        val snapshot = case("play_lights_first_word").getJSONObject("expect").toSnapshot()

        assertEquals("playing", snapshot.status)
        assertEquals(0, snapshot.unit)
        assertEquals(2, snapshot.unitCount)
        assertEquals(0, snapshot.token)
        assertEquals(2, snapshot.tokenCount)
        assertEquals("Hello world.", snapshot.utterance)
        assertEquals(Highlight(start = 0, end = 5), snapshot.highlight)
    }

    @Test
    fun `a null highlight decodes to null, not a crash`() {
        val snapshot =
            case("seek_byte_jumps_to_second_sentence").getJSONObject("expect").toSnapshot()

        assertNull(snapshot.highlight)
        assertEquals(1, snapshot.unit)
        assertEquals("Bye.", snapshot.utterance)
    }

    /**
     * Every command in the fixtures re-encodes to the same JSON tag and field
     * names. This is the direction that actually crashes at runtime: Rust's
     * `#[serde(tag = "type")]` rejects an unknown or misspelled tag, and nothing
     * in the Kotlin build would catch it.
     */
    @Test
    fun `every fixture command re-encodes with identical tag and field names`() {
        for (testCase in cases()) {
            val name = testCase.getString("name")
            val expected = testCase.getJSONObject("command")
            val actual = kotlinCommand(expected) ?: error("$name: no Kotlin builder maps to $expected")

            assertEquals(
                expected.keySet().sorted(),
                actual.keySet().sorted(),
                "$name: field names differ from the fixture",
            )
            for (key in expected.keySet()) {
                assertEquals(
                    expected.get(key).toString(),
                    actual.get(key).toString(),
                    "$name: field `$key`",
                )
            }
        }
    }

    /**
     * Map a fixture's raw command onto the builder it represents. Exhaustive
     * over the tag on purpose: a new protocol command makes this return null and
     * the test above fails loudly, rather than the fixture being skipped.
     */
    private fun kotlinCommand(raw: JSONObject): JSONObject? =
        when (raw.getString("type")) {
            "Play" -> AloudCommand.play()
            "Pause" -> AloudCommand.pause()
            "Next" -> AloudCommand.next()
            "Prev" -> AloudCommand.prev()
            "GetState" -> AloudCommand.getState()
            "SeekUnit" -> AloudCommand.seekUnit(raw.getInt("unit"))
            "SeekByte" -> AloudCommand.seekByte(raw.getInt("byte"))
            "WordBoundary" -> AloudCommand.wordBoundary(raw.getInt("utf16Offset"))
            else -> null
        }
}
