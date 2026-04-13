import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export function PrivacyPolicyPage() {
    const navigate = useNavigate();

    return (
        <div className="min-h-screen flex flex-col">
            {/* Header */}
            <div className="p-6">
                <button
                    onClick={() => navigate('/')}
                    className="flex items-center gap-2 text-sm text-neutral-400 hover:text-white transition"
                >
                    <ArrowLeft size={16} />
                    Back to home
                </button>
            </div>

            {/* Content */}
            <div className="flex-1 flex flex-col items-center px-6 pb-16">
                <div className="max-w-3xl w-full">
                    <h1 className="text-4xl md:text-5xl font-bold text-center mb-4">
                        Privacy Policy
                    </h1>
                    <p className="text-sm text-neutral-500 text-center mb-12">
                        Last updated: April 13, 2026
                    </p>

                    <div className="space-y-10 text-neutral-300 leading-relaxed">
                        {/* 1. Introduction */}
                        <section>
                            <h2 className="text-xl font-semibold text-neutral-100 mb-3">1. Introduction</h2>
                            <p>
                                Synapse is an AI-native product definition environment that helps you transform
                                product ideas into structured artifacts such as PRDs, mockups, and implementation
                                assets. This Privacy Policy explains how we collect, use, and protect your
                                information when you use our service. We believe in being straightforward about
                                our data practices, and we encourage you to read this policy carefully.
                            </p>
                        </section>

                        {/* 2. Information We Collect */}
                        <section>
                            <h2 className="text-xl font-semibold text-neutral-100 mb-3">2. Information We Collect</h2>
                            <p className="mb-3">We may collect the following types of information:</p>
                            <ul className="list-disc list-inside space-y-2 ml-2">
                                <li>
                                    <span className="font-medium text-neutral-200">Account information</span> — When you
                                    sign in using a third-party provider such as LinkedIn, we receive basic profile
                                    information that you authorize during the sign-in process. This may include your
                                    name, email address, and profile identifier.
                                </li>
                                <li>
                                    <span className="font-medium text-neutral-200">Usage data</span> — Information about
                                    how you interact with Synapse, such as features used, session duration, and
                                    general activity patterns.
                                </li>
                                <li>
                                    <span className="font-medium text-neutral-200">Content you create</span> — Product
                                    definitions, mockups, and other artifacts you generate within the platform.
                                </li>
                                <li>
                                    <span className="font-medium text-neutral-200">Communications</span> — Any messages
                                    or feedback you send to us directly.
                                </li>
                            </ul>
                        </section>

                        {/* 3. How We Use Information */}
                        <section>
                            <h2 className="text-xl font-semibold text-neutral-100 mb-3">3. How We Use Information</h2>
                            <p className="mb-3">We use the information we collect to:</p>
                            <ul className="list-disc list-inside space-y-2 ml-2">
                                <li>Authenticate your account and provide access to the service</li>
                                <li>Operate, maintain, and improve Synapse</li>
                                <li>Personalize your experience within the platform</li>
                                <li>Communicate with you about your account or the service</li>
                                <li>Respond to your requests, questions, or feedback</li>
                                <li>Ensure the security and integrity of the platform</li>
                            </ul>
                        </section>

                        {/* 4. LinkedIn Sign-In */}
                        <section>
                            <h2 className="text-xl font-semibold text-neutral-100 mb-3">4. LinkedIn Sign-In</h2>
                            <p className="mb-3">
                                Synapse offers the option to sign in using your LinkedIn account. When you choose
                                to authenticate with LinkedIn, we receive only the basic account information
                                permitted by your authorization. This typically includes your name, email address,
                                and profile identifier.
                            </p>
                            <p className="mb-3">
                                We use this information to create and manage your Synapse account, authenticate
                                your sessions, and provide you with a personalized experience. We do not access
                                your LinkedIn connections, post on your behalf, or retrieve information beyond
                                what is needed for authentication and basic account functionality.
                            </p>
                            <p>
                                Synapse does not use LinkedIn information to contact you, message you on LinkedIn,
                                or conduct outreach of any kind unless you have explicitly opted in to follow-up
                                communications as described below.
                            </p>
                        </section>

                        {/* 5. Optional Follow-Up Communications */}
                        <section>
                            <h2 className="text-xl font-semibold text-neutral-100 mb-3">5. Optional Follow-Up Communications</h2>
                            <p className="mb-3">
                                If you explicitly opt in, Synapse may contact you to:
                            </p>
                            <ul className="list-disc list-inside space-y-2 ml-2">
                                <li>Follow up about your experience with the product</li>
                                <li>Gather feedback to help improve Synapse</li>
                                <li>Discuss a product demo or walkthrough</li>
                                <li>Continue a relevant professional conversation</li>
                            </ul>
                            <p className="mt-3">
                                This communication is entirely optional and will only occur if you provide clear,
                                affirmative consent. You may withdraw your consent at any time by contacting us,
                                and we will promptly cease any follow-up communications.
                            </p>
                        </section>

                        {/* 6. Data Sharing */}
                        <section>
                            <h2 className="text-xl font-semibold text-neutral-100 mb-3">6. Data Sharing</h2>
                            <p className="mb-3">
                                Synapse does not sell your personal data. We may share information only in the
                                following limited circumstances:
                            </p>
                            <ul className="list-disc list-inside space-y-2 ml-2">
                                <li>
                                    <span className="font-medium text-neutral-200">Service providers</span> — With
                                    trusted third-party services that help us operate the platform, such as hosting
                                    and authentication providers, subject to appropriate confidentiality obligations.
                                </li>
                                <li>
                                    <span className="font-medium text-neutral-200">Legal requirements</span> — When
                                    required by law, regulation, or valid legal process.
                                </li>
                                <li>
                                    <span className="font-medium text-neutral-200">Safety and protection</span> — To
                                    protect the rights, safety, or property of Synapse, our users, or the public.
                                </li>
                            </ul>
                        </section>

                        {/* 7. Data Retention */}
                        <section>
                            <h2 className="text-xl font-semibold text-neutral-100 mb-3">7. Data Retention</h2>
                            <p>
                                We retain your information for as long as your account is active or as needed to
                                provide you with the service. If you request deletion of your account, we will
                                remove your personal information within a reasonable timeframe, except where
                                retention is required for legitimate business purposes or legal obligations.
                            </p>
                        </section>

                        {/* 8. Your Choices and Rights */}
                        <section>
                            <h2 className="text-xl font-semibold text-neutral-100 mb-3">8. Your Choices and Rights</h2>
                            <p className="mb-3">You have the following choices regarding your data:</p>
                            <ul className="list-disc list-inside space-y-2 ml-2">
                                <li>
                                    <span className="font-medium text-neutral-200">Access and correction</span> — You
                                    may request access to the personal information we hold about you and ask us to
                                    correct any inaccuracies.
                                </li>
                                <li>
                                    <span className="font-medium text-neutral-200">Deletion</span> — You may request
                                    that we delete your account and associated personal information.
                                </li>
                                <li>
                                    <span className="font-medium text-neutral-200">Withdraw consent</span> — If you
                                    have opted in to follow-up communications, you may withdraw that consent at any
                                    time by contacting us.
                                </li>
                                <li>
                                    <span className="font-medium text-neutral-200">Disconnect LinkedIn</span> — You
                                    may revoke Synapse's access to your LinkedIn account at any time through your
                                    LinkedIn account settings.
                                </li>
                            </ul>
                            <p className="mt-3">
                                To exercise any of these rights, please contact us using the information in
                                the Contact Us section below.
                            </p>
                        </section>

                        {/* 9. Data Security */}
                        <section>
                            <h2 className="text-xl font-semibold text-neutral-100 mb-3">9. Data Security</h2>
                            <p>
                                We implement reasonable technical and organizational measures to protect your
                                information against unauthorized access, loss, or misuse. While no system is
                                completely secure, we take the protection of your data seriously and continuously
                                work to maintain appropriate safeguards.
                            </p>
                        </section>

                        {/* 10. Third-Party Services */}
                        <section>
                            <h2 className="text-xl font-semibold text-neutral-100 mb-3">10. Third-Party Services</h2>
                            <p>
                                Synapse integrates with third-party services for authentication, hosting, and
                                AI functionality. These services operate under their own privacy policies, and
                                we encourage you to review them. Our use of third-party services is limited to
                                what is necessary to operate and improve the platform. We do not control and are
                                not responsible for the privacy practices of these third parties.
                            </p>
                        </section>

                        {/* 11. Children's Privacy */}
                        <section>
                            <h2 className="text-xl font-semibold text-neutral-100 mb-3">11. Children&apos;s Privacy</h2>
                            <p>
                                Synapse is not intended for use by individuals under the age of 16. We do not
                                knowingly collect personal information from children. If we become aware that we
                                have collected information from a child under 16, we will take steps to delete
                                that information promptly.
                            </p>
                        </section>

                        {/* 12. Changes to This Policy */}
                        <section>
                            <h2 className="text-xl font-semibold text-neutral-100 mb-3">12. Changes to This Policy</h2>
                            <p>
                                We may update this Privacy Policy from time to time to reflect changes in our
                                practices or for other operational, legal, or regulatory reasons. When we make
                                changes, we will update the &ldquo;Last updated&rdquo; date at the top of this page. We
                                encourage you to review this policy periodically.
                            </p>
                        </section>

                        {/* 13. Contact Us */}
                        <section>
                            <h2 className="text-xl font-semibold text-neutral-100 mb-3">13. Contact Us</h2>
                            <p>
                                If you have questions about this Privacy Policy, wish to exercise your data
                                rights, or would like to withdraw consent for follow-up communications, please
                                contact us at{' '}
                                <a
                                    href="mailto:contact@synapseapp.com"
                                    className="text-indigo-400 hover:text-indigo-300 transition"
                                >
                                    contact@synapseapp.com
                                </a>.
                            </p>
                        </section>
                    </div>
                </div>
            </div>
        </div>
    );
}
