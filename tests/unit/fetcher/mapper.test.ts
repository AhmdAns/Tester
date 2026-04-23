import { describe, it, expect } from 'vitest';
import {
  htmlToText,
  getRelationType,
  parseRelations,
  mapRawToWorkItem,
} from '../../../src/modules/fetcher/mapper.js';
import type { RawWorkItem } from '../../../src/modules/fetcher/ado-client.js';

describe('htmlToText', () => {
  it('strips HTML tags', () => {
    expect(htmlToText('<p>Hello <strong>world</strong></p>')).toBe('Hello world');
  });

  it('converts <br> to newline', () => {
    expect(htmlToText('Line 1<br/>Line 2')).toBe('Line 1\nLine 2');
  });

  it('converts </p> to newline', () => {
    const result = htmlToText('<p>First</p><p>Second</p>');
    expect(result).toContain('First');
    expect(result).toContain('Second');
  });

  it('decodes HTML entities', () => {
    expect(htmlToText('&lt;foo&gt; &amp; &quot;bar&quot; &#39;baz&#39;')).toBe(
      "<foo> & \"bar\" 'baz'",
    );
  });

  it('replaces &nbsp; with space', () => {
    expect(htmlToText('a&nbsp;b')).toBe('a b');
  });

  it('returns empty string for empty input', () => {
    expect(htmlToText('')).toBe('');
  });

  it('collapses excess newlines', () => {
    const result = htmlToText('<p>a</p>\n\n\n\n<p>b</p>');
    expect(result).not.toMatch(/\n{3,}/);
  });
});

describe('getRelationType', () => {
  it('identifies parent (Hierarchy-Reverse)', () => {
    expect(getRelationType('System.LinkTypes.Hierarchy-Reverse')).toBe('parent');
  });

  it('identifies child (Hierarchy-Forward)', () => {
    expect(getRelationType('System.LinkTypes.Hierarchy-Forward')).toBe('child');
  });

  it('identifies blocks (Blocks-Forward)', () => {
    expect(getRelationType('Microsoft.VSTS.Common.Blocks-Forward')).toBe('blocks');
  });

  it('identifies blocked-by (Blocks-Reverse)', () => {
    expect(getRelationType('Microsoft.VSTS.Common.Blocks-Reverse')).toBe('blocked-by');
  });

  it('identifies tested-by', () => {
    expect(getRelationType('Microsoft.VSTS.Common.TestedBy-Forward')).toBe('tested-by');
  });

  it('defaults unknown relation types to related', () => {
    expect(getRelationType('SomeCustom.LinkType')).toBe('related');
  });
});

describe('parseRelations', () => {
  it('returns empty array for undefined', () => {
    expect(parseRelations(undefined)).toEqual([]);
  });

  it('returns empty array for empty input', () => {
    expect(parseRelations([])).toEqual([]);
  });

  it('filters out non-work-item URLs', () => {
    const relations = [
      { rel: 'ArtifactLink', url: 'vstfs:///Build/Build/123', attributes: {} },
    ];
    expect(parseRelations(relations)).toEqual([]);
  });

  it('maps a work item relation correctly', () => {
    const relations = [
      {
        rel: 'System.LinkTypes.Hierarchy-Reverse',
        url: 'https://dev.azure.com/org/proj/_apis/wit/workItems/100',
        attributes: { name: 'Parent', isLocked: false },
      },
    ];
    const result = parseRelations(relations);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ type: 'parent', id: 100 });
  });

  it('maps multiple relations', () => {
    const relations = [
      {
        rel: 'System.LinkTypes.Hierarchy-Forward',
        url: 'https://dev.azure.com/org/proj/_apis/wit/workItems/200',
        attributes: {},
      },
      {
        rel: 'System.LinkTypes.Hierarchy-Forward',
        url: 'https://dev.azure.com/org/proj/_apis/wit/workItems/201',
        attributes: {},
      },
    ];
    const result = parseRelations(relations);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id)).toEqual([200, 201]);
  });
});

describe('mapRawToWorkItem', () => {
  const baseRaw: RawWorkItem = {
    id: 12345,
    fields: {
      'System.WorkItemType': 'User Story',
      'System.Title': 'As a user, I can log in',
      'System.Description': '<p>Log in with <strong>username</strong> and password.</p>',
      'Microsoft.VSTS.Common.AcceptanceCriteria':
        '<ul><li>Login form is shown</li><li>Error on bad password</li></ul>',
      'System.State': 'Active',
      'Microsoft.VSTS.Common.Priority': 2,
      'System.AssignedTo': { displayName: 'John Doe', id: 'abc123' },
      'System.AreaPath': 'MyProject\\Auth',
      'System.IterationPath': 'MyProject\\Sprint 1',
      'System.Tags': 'auth; security; login',
      'System.CreatedDate': '2024-01-01T00:00:00Z',
      'System.ChangedDate': '2024-01-15T00:00:00Z',
    },
  };

  it('maps id and type', () => {
    const item = mapRawToWorkItem(baseRaw);
    expect(item.id).toBe(12345);
    expect(item.type).toBe('User Story');
  });

  it('maps state and priority', () => {
    const item = mapRawToWorkItem(baseRaw);
    expect(item.state).toBe('Active');
    expect(item.priority).toBe(2);
  });

  it('strips HTML from description', () => {
    const item = mapRawToWorkItem(baseRaw);
    expect(item.description).not.toContain('<');
    expect(item.description).toContain('username');
  });

  it('strips HTML from acceptance criteria', () => {
    const item = mapRawToWorkItem(baseRaw);
    expect(item.acceptanceCriteria).not.toContain('<');
    expect(item.acceptanceCriteria).toContain('Login form is shown');
    expect(item.acceptanceCriteria).toContain('Error on bad password');
  });

  it('parses tags from semicolon-delimited string', () => {
    const item = mapRawToWorkItem(baseRaw);
    expect(item.tags).toEqual(['auth', 'security', 'login']);
  });

  it('extracts assignedTo display name from object', () => {
    const item = mapRawToWorkItem(baseRaw);
    expect(item.assignedTo).toBe('John Doe');
  });

  it('handles string assignedTo', () => {
    const raw: RawWorkItem = {
      ...baseRaw,
      fields: { ...baseRaw.fields, 'System.AssignedTo': 'jane@example.com' },
    };
    const item = mapRawToWorkItem(raw);
    expect(item.assignedTo).toBe('jane@example.com');
  });

  it('returns empty relations when none provided', () => {
    const item = mapRawToWorkItem(baseRaw);
    expect(item.relations).toEqual([]);
  });

  it('maps relations when provided', () => {
    const raw: RawWorkItem = {
      ...baseRaw,
      relations: [
        {
          rel: 'System.LinkTypes.Hierarchy-Reverse',
          url: 'https://dev.azure.com/org/proj/_apis/wit/workItems/100',
          attributes: { name: 'Parent' },
        },
      ],
    };
    const item = mapRawToWorkItem(raw);
    expect(item.relations).toHaveLength(1);
    expect(item.relations[0]).toMatchObject({ type: 'parent', id: 100 });
  });

  it('returns empty tags for missing System.Tags field', () => {
    const raw: RawWorkItem = {
      ...baseRaw,
      fields: { ...baseRaw.fields, 'System.Tags': undefined },
    };
    const item = mapRawToWorkItem(raw);
    expect(item.tags).toEqual([]);
  });

  it('preserves rawFields', () => {
    const item = mapRawToWorkItem(baseRaw);
    expect(item.rawFields['System.Title']).toBe('As a user, I can log in');
  });
});
