import React from 'react';

interface TermsOfServiceProps {
  isDarkMode: boolean;
  onBack: () => void;
}

export const TermsOfService: React.FC<TermsOfServiceProps> = ({ isDarkMode, onBack }) => {
  return (
    <div className={(isDarkMode ? 'bg-[#000000] text-white' : 'bg-white text-gray-900') + ' h-screen overflow-y-auto'}>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Terms of Service</h1>
          <button
            type="button"
            onClick={onBack}
            className={
              'text-sm px-4 py-2 rounded-2xl border transition-colors ' +
              (isDarkMode
                ? 'border-white/[0.10] bg-white/5 hover:bg-white/10 text-white'
                : 'border-gray-200 bg-gray-50 hover:bg-gray-100 text-gray-900')
            }
          >
            Back
          </button>
        </div>

        <div className={"mt-2 text-xs " + (isDarkMode ? 'text-[#86868b]' : 'text-gray-500')}>
          Effective date: {new Date().toISOString().slice(0, 10)}
        </div>

        <div className={"mt-8 space-y-6 text-sm leading-relaxed " + (isDarkMode ? 'text-[#c7c7cc]' : 'text-gray-700')}>
          <p>
            These Terms of Service ("Terms") govern your access to and use of FreshFront (the "Service"), including
            creating accounts, running research sessions, generating reports and assets, uploading files to your project
            knowledge base, and publishing shareable report links.
          </p>

          <div>
            <h2 className={"text-base font-semibold tracking-tight " + (isDarkMode ? 'text-white' : 'text-gray-900')}>
              1. Using the Service
            </h2>
            <p className="mt-2">
              You must use the Service in compliance with applicable laws and these Terms. You are responsible for all
              activity under your account and for keeping your credentials secure.
            </p>
          </div>

          <div>
            <h2 className={"text-base font-semibold tracking-tight " + (isDarkMode ? 'text-white' : 'text-gray-900')}>
              2. Accounts, projects, and shared reports
            </h2>
            <p className="mt-2">
              FreshFront lets you organize work into projects, run research sessions, and generate interactive reports.
              If you choose to publish a report as a shareable link, you are responsible for confirming the content is
              appropriate to share and does not disclose sensitive information.
            </p>
          </div>

          <div>
            <h2 className={"text-base font-semibold tracking-tight " + (isDarkMode ? 'text-white' : 'text-gray-900')}>
              3. User content and uploads
            </h2>
            <p className="mt-2">
              You retain ownership of your inputs (including files, prompts, notes, and project content) and the outputs
              you generate, subject to third-party rights in underlying materials and the terms of any third-party
              services you use through FreshFront.
            </p>
            <p className="mt-2">
              You represent that you have the rights and permissions needed to upload and process any content you submit
              (including personal data, copyrighted materials, and sensitive information).
            </p>
          </div>

          <div>
            <h2 className={"text-base font-semibold tracking-tight " + (isDarkMode ? 'text-white' : 'text-gray-900')}>
              4. Acceptable use
            </h2>
            <p className="mt-2">You agree not to:</p>
            <ul className="mt-2 space-y-1 list-disc pl-5">
              <li>Use the Service for illegal activity, harmful harassment, or exploitation.</li>
              <li>Attempt to reverse engineer, disrupt, or overload the Service.</li>
              <li>
                Upload content you do not have permission to use or that violates privacy, intellectual property, or
                other rights.
              </li>
              <li>Use the Service to generate or distribute deceptive content intended to mislead others.</li>
            </ul>
          </div>

          <div>
            <h2 className={"text-base font-semibold tracking-tight " + (isDarkMode ? 'text-white' : 'text-gray-900')}>
              5. AI features, sources, and reliability
            </h2>
            <p className="mt-2">
              FreshFront may use third-party AI models and tools to help you research and produce outputs. AI can make
              mistakes. You are responsible for reviewing outputs before relying on them.
            </p>
            <p className="mt-2">
              Where the Service provides citations or sources, those are intended to help verification, but they are not
              a guarantee of completeness or accuracy.
            </p>
          </div>

          <div>
            <h2 className={"text-base font-semibold tracking-tight " + (isDarkMode ? 'text-white' : 'text-gray-900')}>
              6. Subscriptions and billing
            </h2>
            <p className="mt-2">
              Some features may require a paid subscription. Billing and payments are processed by third-party payment
              providers. Your subscription status may be stored in your account profile to enable access.
            </p>
            <p className="mt-2">
              Where "unlimited" usage is referenced, it denotes the maximum permissible utilization of the Service,
              which remains subject to the rate limits, quotas, and terms imposed by our integrated AI models
              and third-party platform partners.
            </p>
          </div>

          <div>
            <h2 className={"text-base font-semibold tracking-tight " + (isDarkMode ? 'text-white' : 'text-gray-900')}>
              7. Termination
            </h2>
            <p className="mt-2">
              We may suspend or terminate access if we reasonably believe you violated these Terms or if necessary to
              protect the Service, users, or third parties. You may stop using the Service at any time.
            </p>
          </div>

          <div>
            <h2 className={"text-base font-semibold tracking-tight " + (isDarkMode ? 'text-white' : 'text-gray-900')}>
              8. Disclaimers and limitation of liability
            </h2>
            <p className="mt-2">
              The Service is provided on an “as is” and “as available” basis. To the maximum extent permitted by law, we
              disclaim all warranties and will not be liable for indirect, incidental, special, consequential, or
              punitive damages, or any loss of profits or data.
            </p>
          </div>

          <div>
            <h2 className={"text-base font-semibold tracking-tight " + (isDarkMode ? 'text-white' : 'text-gray-900')}>
              9. Changes
            </h2>
            <p className="mt-2">
              We may update these Terms from time to time. Continued use of the Service after an update means you accept
              the updated Terms.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
