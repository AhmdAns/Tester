export type TestType =
  | 'Happy Path'
  | 'Boundary Value'
  | 'Negative / Error'
  | 'Integration'
  | 'Security'
  | 'Performance'
  | 'Accessibility'
  | 'Regression Hook'
  | 'Edge Case';

export interface TestStep {
  stepNumber: number;
  action: string;
  expectedResult: string;
  testData?: string;
}

export interface TestCase {
  title: string;
  description: string;
  priority: 1 | 2 | 3 | 4;
  areaPath: string;
  iterationPath: string;
  automationStatus: 'Not Automated' | 'Planned' | 'Automated';
  tags: string[];
  steps: TestStep[];
  associatedWorkItems: number[];
  testType: TestType;
  preconditions: string;
  expectedOutcome: string;
}

export interface DesignOptions {
  model?: string;
  contextTopK?: number;
  coverageRules?: {
    requireHappyPath?: boolean;
    requireBoundaryValues?: boolean;
    requireNegativeTests?: boolean;
    requireSecurityTest?: boolean | 'auto';
    requireA11yTest?: boolean | 'auto';
  };
  outputFormat?: 'json' | 'md' | 'csv' | 'xlsx';
  outputPath?: string;
}
