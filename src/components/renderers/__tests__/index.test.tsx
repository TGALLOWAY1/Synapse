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

    it('renders structured content for screen_inventory when content is valid JSON', () => {
        const jsonContent = JSON.stringify({
            groups: [{
                name: 'Auth',
                screens: [{
                    name: 'Login',
                    purpose: 'User authentication',
                    components: ['EmailInput', 'PasswordInput'],
                    priority: 'core',
                }],
            }],
        });
        const { container } = render(
            <ArtifactContentRenderer subtype="screen_inventory" content={jsonContent} />
        );
        // Should render via ScreenInventoryRenderer with card layout
        expect(container).toHaveTextContent('Login');
        expect(container).toHaveTextContent('User authentication');
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
