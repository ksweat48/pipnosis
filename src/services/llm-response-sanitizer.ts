/**
 * LLM Response Sanitizer
 *
 * SSOT Authority for cleaning LLM responses before JSON parsing
 * Handles markdown code blocks, extra whitespace, and other formatting issues
 *
 * GOVERNANCE: All LLM response parsing MUST use this sanitizer to prevent
 * inconsistent error handling and duplicated cleanup logic
 */

/**
 * Remove markdown code blocks and clean LLM response for JSON parsing
 *
 * Handles these patterns:
 * - ```json\n{...}\n```
 * - ```\n{...}\n```
 * - Extra whitespace and newlines
 *
 * @param response Raw LLM response string
 * @returns Cleaned JSON string ready for parsing
 */
export function sanitizeLLMResponse(response: string): string {
  if (!response || typeof response !== 'string') {
    throw new Error('[LLM Sanitizer] Invalid response: must be non-empty string');
  }

  try {
    // Step 1: Remove markdown code block delimiters
    let cleaned = response
      .replace(/```json\n?/gi, '')  // Remove ```json or ```JSON
      .replace(/```javascript\n?/gi, '') // Remove ```javascript
      .replace(/```\n?/g, '')        // Remove standalone ```
      .trim();                        // Remove leading/trailing whitespace

    // Step 2: Remove any leading/trailing quotes if entire response is quoted
    if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
      cleaned = cleaned.slice(1, -1);
    }

    // Step 3: Remove trailing commas before closing braces/brackets (invalid JSON per spec,
    // but commonly emitted by gpt-4o-mini when the last property has a trailing comma)
    // e.g. { "foo": "bar", } -> { "foo": "bar" }
    cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1');

    // Step 4: Ensure we have valid JSON start/end characters
    if (!cleaned.startsWith('{') && !cleaned.startsWith('[')) {
      // Try to find JSON object/array in the response
      const jsonMatch = cleaned.match(/[\{\[][\s\S]*[\}\]]/);
      if (jsonMatch) {
        cleaned = jsonMatch[0];
      } else {
        throw new Error('[LLM Sanitizer] No valid JSON found in response');
      }
    }

    return cleaned;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[LLM Sanitizer] ❌ Failed to sanitize response:', errorMsg);
    console.error('[LLM Sanitizer] Raw response preview:', response.substring(0, 200));
    throw new Error(`LLM response sanitization failed: ${errorMsg}`);
  }
}

/**
 * Sanitize and parse LLM response in one step
 *
 * @param response Raw LLM response string
 * @param context Description of what's being parsed (for error messages)
 * @returns Parsed JSON object
 */
export function sanitizeAndParse<T = any>(response: string, context: string = 'LLM response'): T {
  try {
    const cleaned = sanitizeLLMResponse(response);
    return JSON.parse(cleaned) as T;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[LLM Sanitizer] ❌ Failed to parse ${context}:`, errorMsg);
    console.error('[LLM Sanitizer] Response preview:', response.substring(0, 200));
    throw new Error(`Failed to parse ${context}: ${errorMsg}`);
  }
}

/**
 * Try to sanitize and parse LLM response, returning null on failure
 * Use this for non-critical parsing where graceful degradation is acceptable
 *
 * @param response Raw LLM response string
 * @param context Description of what's being parsed
 * @returns Parsed object or null on failure
 */
export function tryParseLLMResponse<T = any>(
  response: string,
  context: string = 'LLM response'
): T | null {
  try {
    return sanitizeAndParse<T>(response, context);
  } catch (error) {
    console.warn(`[LLM Sanitizer] ⚠️ Could not parse ${context}, returning null`);
    return null;
  }
}
