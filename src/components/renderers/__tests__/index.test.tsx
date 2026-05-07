import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ArtifactContentRenderer } from '../index';

describe('ArtifactContentRenderer', () => {
    it('renders markdown content for screen_inventory when content is not JSON', () => {
        const markdownContent = '# Screen Inventory\n\n## Auth Group\n\n### Login Screen\n- Purpose: User authentication';
        const { container } = render(
            <ArtifactContentRenderer subtype="screen_inventory" content={markdownContent} />
        );
        // Should render via ReactMarkdown, producing an h1
        expect(container.querySelector('h1')).toHaveTextContent('Screen Inventory');
    });

    it('renders structured content for screen_inventory in the new sections shape', () => {
        const jsonContent = JSON.stringify({
            sections: [{
                title: 'Mood Capture',
                description: 'Where the user records a vibe.',
                flowSummary: 'Landing → Capture → Loading → Player',
                screens: [{
                    name: 'Mood Ingestion Portal',
                    type: 'screen',
                    priority: 'P0',
                    purpose: 'Capture a mood signal from the camera',
                    userIntent: 'Share a vibe in under 5 seconds',
                    states: [
                        { name: 'Default', description: 'Camera active' },
                        { name: 'Loading', description: 'Submitting capture' },
                        { name: 'Camera denied', description: 'Permission refused', trigger: 'permission denied' },
                    ],
                    entryPoints: ['Landing', 'Shared Vibe'],
                    exitPaths: [
                        { label: 'Submit', target: 'Loading' },
                        { label: 'Camera denied', target: 'Text Fallback', condition: 'permission denied' },
                    ],
                    coreUIElements: ['Mood capture canvas', 'Submit CTA'],
                    outputData: ['mood vector'],
                    risks: ['Camera permission denied'],
                    featureRefs: ['F-014'],
                }],
            }],
        });
        const { container } = render(
            <ArtifactContentRenderer subtype="screen_inventory" content={jsonContent} />
        );
        // Section header is numbered.
        expect(container).toHaveTextContent('1.');
        expect(container).toHaveTextContent('Mood Capture');
        expect(container).toHaveTextContent('Mood Ingestion Portal');
        // Priority badge.
        expect(container).toHaveTextContent('P0');
        // User intent + state chip.
        expect(container).toHaveTextContent('Share a vibe in under 5 seconds');
        expect(container).toHaveTextContent('Camera denied');
        // Exit path target.
        expect(container).toHaveTextContent('Text Fallback');
        // Risk callout copy.
        expect(container).toHaveTextContent('Camera permission denied');
    });

    it('renders legacy groups + core/secondary priorities by normalizing on read', () => {
        const legacyJson = JSON.stringify({
            groups: [{
                name: 'Auth',
                screens: [{
                    name: 'Login',
                    purpose: 'User authentication',
                    components: ['EmailInput', 'PasswordInput'],
                    priority: 'core',
                    navigationFrom: ['Landing'],
                    navigationTo: ['Dashboard'],
                }],
            }],
        });
        const { container } = render(
            <ArtifactContentRenderer subtype="screen_inventory" content={legacyJson} />
        );
        expect(container).toHaveTextContent('Login');
        // Legacy 'core' migrates to P0.
        expect(container).toHaveTextContent('P0');
        // Legacy components survive as core UI.
        expect(container).toHaveTextContent('EmailInput');
        // Legacy navigation surfaces as entry/exit blocks.
        expect(container).toHaveTextContent('Landing');
        expect(container).toHaveTextContent('Dashboard');
    });

    it('renders markdown for subtypes without structured renderers', () => {
        const content = '# User Flows\n\n## Login Flow\n\n1. User opens app\n2. User enters credentials';
        const { container } = render(
            <ArtifactContentRenderer subtype="user_flows" content={content} />
        );
        expect(container.querySelector('h1')).toHaveTextContent('User Flows');
        expect(container.querySelector('ol')).toBeTruthy();
    });

    it('falls back to markdown when JSON is malformed for structured type', () => {
        const badJson = '{ this is not valid json }';
        const { container } = render(
            <ArtifactContentRenderer subtype="data_model" content={badJson} />
        );
        // Should not crash — renders as text via ReactMarkdown
        expect(container).toHaveTextContent('this is not valid json');
    });

    it('renders structured data_model content when valid JSON is provided', () => {
        const jsonContent = JSON.stringify({
            entities: [{
                name: 'User',
                description: 'Application user',
                fields: [
                    { name: 'id', type: 'UUID', required: true, description: 'Primary key' },
                    { name: 'email', type: 'string', required: true, description: 'Email address' },
                ],
            }],
            relationships: [],
        });
        const { container } = render(
            <ArtifactContentRenderer subtype="data_model" content={jsonContent} />
        );
        expect(container).toHaveTextContent('User');
        expect(container).toHaveTextContent('email');
    });
});
