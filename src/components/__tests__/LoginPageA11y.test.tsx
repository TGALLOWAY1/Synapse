import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LoginPage } from '../LoginPage';
import { useAuthStore } from '../../store/authStore';

// SYN-007 / SYN-018 regression coverage: auth inputs must have programmatic
// labels + error associations, and the dead "Forgot password?" control must
// not exist.

function renderLoginPage() {
    return render(
        <MemoryRouter initialEntries={['/']}>
            <LoginPage />
        </MemoryRouter>,
    );
}

beforeEach(() => {
    // Stub the store's async actions so submitting never makes a real network
    // call — mirrors DemoEntryRouting.test.tsx's direct useAuthStore.setState
    // pattern rather than mocking the recruiterApi module.
    useAuthStore.setState({
        user: null,
        loading: false,
        authError: null,
        loginWithEmail: vi.fn().mockResolvedValue({ ok: true, user: null }),
        signupWithEmail: vi.fn().mockResolvedValue({ ok: true, user: null }),
    });
});

describe('LoginPage accessibility (SYN-007)', () => {
    it('exposes the email input with a programmatic accessible name', () => {
        renderLoginPage();

        const emailInput = screen.getByRole('textbox', { name: /email/i });
        expect(emailInput).toBeInTheDocument();
        expect(emailInput).toHaveAttribute('id', 'login-email');
    });

    it('exposes the password input by label text (not role=textbox)', () => {
        renderLoginPage();

        const passwordInput = screen.getByLabelText(/password/i);
        expect(passwordInput).toBeInTheDocument();
        expect(passwordInput).toHaveAttribute('type', 'password');
        // Password inputs don't carry role=textbox.
        expect(screen.queryByRole('textbox', { name: /password/i })).not.toBeInTheDocument();
    });

    it('exposes the name field only in sign-up mode, with a programmatic accessible name', () => {
        renderLoginPage();

        expect(screen.queryByRole('textbox', { name: /^name$/i })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Sign Up' }));

        const nameInput = screen.getByRole('textbox', { name: /^name$/i });
        expect(nameInput).toBeInTheDocument();
        expect(nameInput).toHaveAttribute('id', 'login-name');
    });

    it('sets aria-invalid and a resolving aria-describedby on an invalid email after submit', () => {
        const { container } = renderLoginPage();

        const emailInput = screen.getByRole('textbox', { name: /email/i });
        const passwordInput = screen.getByLabelText(/password/i);
        fireEvent.change(emailInput, { target: { value: 'not-an-email' } });
        fireEvent.change(passwordInput, { target: { value: 'somepassword' } });
        // Two buttons render the text "Sign In" while on the sign-in tab (the
        // tab control and the submit button share a label), so submit the
        // form directly rather than disambiguating by accessible name.
        fireEvent.submit(container.querySelector('form') as HTMLFormElement);

        expect(emailInput).toHaveAttribute('aria-invalid', 'true');
        const describedBy = emailInput.getAttribute('aria-describedby');
        expect(describedBy).toBeTruthy();
        const errorEl = document.getElementById(describedBy as string);
        expect(errorEl).not.toBeNull();
        expect(errorEl).toHaveTextContent(/valid email/i);
    });

    it('sets aria-invalid on an empty email after submit', () => {
        const { container } = renderLoginPage();

        fireEvent.submit(container.querySelector('form') as HTMLFormElement);

        const emailInput = screen.getByRole('textbox', { name: /email/i });
        expect(emailInput).toHaveAttribute('aria-invalid', 'true');
        const describedBy = emailInput.getAttribute('aria-describedby');
        expect(describedBy).toBe('login-email-error');
        expect(screen.getByText(/email is required/i)).toHaveAttribute('id', 'login-email-error');
    });

    it('has no aria-invalid/aria-describedby on the email input before any submit', () => {
        renderLoginPage();

        const emailInput = screen.getByRole('textbox', { name: /email/i });
        expect(emailInput).not.toHaveAttribute('aria-invalid');
        expect(emailInput).not.toHaveAttribute('aria-describedby');
    });

    it('never leaves a stale aria-describedby reference when switching tabs', () => {
        const { container } = renderLoginPage();

        // Trigger a name error in sign-up mode (submit the form empty), then
        // switch back to sign-in — the name input (and its error) unmount, so
        // nothing may still reference the now-absent id.
        fireEvent.click(screen.getByRole('button', { name: 'Sign Up' }));
        const submitButton = container.querySelector('button[type="submit"]');
        expect(submitButton).toBeTruthy();
        fireEvent.click(submitButton as Element);
        expect(document.getElementById('login-name-error')).not.toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

        expect(document.getElementById('login-name-error')).toBeNull();
        expect(document.getElementById('login-name')).toBeNull();
    });
});

describe('LoginPage — dead "Forgot password?" control removed (SYN-018)', () => {
    it('renders no "Forgot password" text or button anywhere', () => {
        renderLoginPage();

        expect(screen.queryByText(/forgot password/i)).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /forgot password/i })).not.toBeInTheDocument();
    });

    it('still has no "Forgot password" control after switching to sign-up and back', () => {
        renderLoginPage();

        fireEvent.click(screen.getByRole('button', { name: 'Sign Up' }));
        fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

        expect(screen.queryByText(/forgot password/i)).not.toBeInTheDocument();
    });
});
