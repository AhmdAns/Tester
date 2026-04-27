import type { DesignOptions } from './types.js';

export const DESIGNER_SYSTEM_PROMPT = `You are a senior QA Architect and Test Engineer following IEEE 829 and ISTQB standards.
Your goal is to generate comprehensive, actionable test cases for Azure DevOps Test Plans.
You design tests against the INTENDED SYSTEM BEHAVIOR, not just the literal text of the user story.
You think about what could go wrong: boundary values, concurrent users, network failures, authorization bypass, accessibility.
You output ONLY valid JSON — no markdown, no prose, no explanation.`;

export const COVERAGE_RULES_TEXT = `## Coverage Requirements (MANDATORY)

You MUST generate test cases that cover ALL of the following:
1. **Happy Path**: At least one happy path test per acceptance criterion
2. **Boundary Value**: Tests for all numeric inputs, date ranges, text length limits
3. **Negative / Error**: Tests for all validation rules (stated or implied), invalid inputs, missing required fields
4. **Authorization**: At least one unauthorized access test for any authenticated feature
5. **Integration**: One integration test per external system or API dependency
6. **Regression Hook**: At least one regression hook per bug found in the same area (if any in context)
7. **Security**: Session handling, injection prevention, data exposure — if the feature handles sensitive data
8. **Accessibility**: Keyboard navigation and screen reader compatibility — if the feature has a UI component`;

export function buildDesignPrompt(
  workItemMd: string,
  contextMd: string,
  tokenCount: number,
  opts: DesignOptions = {},
): string {
  const rules = opts.coverageRules;
  const rulesSection =
    rules?.requireHappyPath === false
      ? '## Coverage Requirements\nGenerate comprehensive test cases as appropriate.'
      : COVERAGE_RULES_TEXT;

  const contextSection = contextMd.trim()
    ? `\n## Related Context (${tokenCount} estimated tokens)\n\n${contextMd}`
    : '';

  const schema = `[
  {
    "title": "string (max 255 chars)",
    "description": "string — test objective",
    "priority": 1|2|3|4,
    "areaPath": "string",
    "iterationPath": "string",
    "automationStatus": "Not Automated|Planned|Automated",
    "tags": ["string"],
    "testType": "Happy Path|Boundary Value|Negative / Error|Integration|Security|Performance|Accessibility|Regression Hook|Edge Case",
    "preconditions": "string",
    "expectedOutcome": "string",
    "associatedWorkItems": [number],
    "steps": [
      {
        "stepNumber": number,
        "action": "string",
        "expectedResult": "string",
        "testData": "string (optional)"
      }
    ]
  }
]`;

  return `## Work Item\n\n${workItemMd}${contextSection}

${rulesSection}

## Output Format

Respond with ONLY a JSON array of test case objects matching this schema exactly:
${schema}

Generate as many test cases as needed to achieve full coverage. Do not skip test types unless they genuinely do not apply.`;
}
