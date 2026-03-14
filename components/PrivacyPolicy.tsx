import React from 'react';

interface PrivacyPolicyProps {
  isDarkMode: boolean;
  onBack: () => void;
}

export const PrivacyPolicy: React.FC<PrivacyPolicyProps> = ({ isDarkMode, onBack }) => {
  return (
    <div className={(isDarkMode ? 'bg-[#000000] text-white' : 'bg-white text-gray-900') + ' h-screen overflow-y-auto'}>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Privacy Policy</h1>
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
            This Privacy Policy describes how FreshFront (the "Service") collects, uses, and shares information when you
            use the app.
          </p>

          <div>
            <h2 className={"text-base font-semibold tracking-tight " + (isDarkMode ? 'text-white' : 'text-gray-900')}>
              1. Information we collect
            </h2>
            <p className="mt-2">We may collect the following categories of information:</p>
            <ul className="mt-2 space-y-1 list-disc pl-5">
              <li>
                Account information (such as email, display name, and authentication provider) when you sign up or log in.
              </li>
              <li>
                Project content you create in the app (projects, research sessions, notes, tasks, generated reports, and
                related assets).
              </li>
              <li>
                Uploaded content you provide to your knowledge base (for example: documents, tables, PDFs, images, audio,
                or video).
              </li>
              <li>
                Usage and product telemetry required to operate the Service (for example: feature usage counters and
                subscription status).
              </li>
            </ul>
          </div>

          <div>
            <h2 className={"text-base font-semibold tracking-tight " + (isDarkMode ? 'text-white' : 'text-gray-900')}>
              2. Microphone and voice features
            </h2>
            <p className="mt-2">
              If you choose to use voice input, the Service may request access to your device microphone. You can deny or
              revoke this permission at any time in your device or browser settings.
            </p>
            <p className="mt-2">
              We aim to process voice input only to provide the feature you requested. Do not use voice input to share
              sensitive information.
            </p>
          </div>

          <div>
            <h2 className={"text-base font-semibold tracking-tight " + (isDarkMode ? 'text-white' : 'text-gray-900')}>
              3. How we use information
            </h2>
            <p className="mt-2">We use information to:</p>
            <ul className="mt-2 space-y-1 list-disc pl-5">
              <li>Provide, maintain, and improve the Service.</li>
              <li>Store your projects, research sessions, and uploaded files.</li>
              <li>Generate research outputs and assets you request.</li>
              <li>Manage subscriptions, billing status, and usage limits.</li>
              <li>Prevent abuse, enforce our Terms, and keep the Service secure.</li>
            </ul>
          </div>

          <div>
            <h2 className={"text-base font-semibold tracking-tight " + (isDarkMode ? 'text-white' : 'text-gray-900')}>
              4. How we share information
            </h2>
            <p className="mt-2">We may share information in the following cases:</p>
            <ul className="mt-2 space-y-1 list-disc pl-5">
              <li>
                With service providers that help run the Service (for example: hosting, databases, file storage,
                authentication, payments, and AI tooling).
              </li>
              <li>
                When you publish a shareable report link: anyone with the link may be able to view the shared report and
                interact with it.
              </li>
              <li>
                If required by law or to protect the rights, safety, and security of users and the Service.
              </li>
            </ul>
          </div>

          <div>
            <h2 className={"text-base font-semibold tracking-tight " + (isDarkMode ? 'text-white' : 'text-gray-900')}>
              5. Third-party services
            </h2>
            <p className="mt-2">
              FreshFront integrates with third-party services to provide core functionality. Depending on your usage,
              these may include:
            </p>
            <ul className="mt-2 space-y-1 list-disc pl-5">
              <li>Authentication and database services (for example, Firebase).</li>
              <li>File storage services (for example, cloud object storage).</li>
              <li>Payments and subscription management (for example, Stripe).</li>
              <li>AI model providers used to generate outputs (for example, Google Gemini).</li>
              <li>Media and asset providers (for example, stock image sources).</li>
            </ul>
            <p className="mt-2">
              These providers may process information in accordance with their own policies.
            </p>
          </div>

          <div>
            <h2 className={"text-base font-semibold tracking-tight " + (isDarkMode ? 'text-white' : 'text-gray-900')}>
              6. Data retention
            </h2>
            <p className="mt-2">
              We retain your account and project data for as long as needed to provide the Service, including maintaining
              your saved projects and reports. Shared report links may remain accessible until they are removed.
            </p>
          </div>

          <div>
            <h2 className={"text-base font-semibold tracking-tight " + (isDarkMode ? 'text-white' : 'text-gray-900')}>
              7. Security
            </h2>
            <p className="mt-2">
              We use reasonable safeguards designed to protect information. However, no method of transmission or
              storage is completely secure.
            </p>
          </div>

          <div>
            <h2 className={"text-base font-semibold tracking-tight " + (isDarkMode ? 'text-white' : 'text-gray-900')}>
              8. Your choices
            </h2>
            <ul className="mt-2 space-y-1 list-disc pl-5">
              <li>You can choose not to upload files or provide optional information.</li>
              <li>You can revoke microphone access in your device/browser settings.</li>
              <li>Be cautious before publishing share links that may expose private information.</li>
            </ul>
          </div>

          <div>
            <h2 className={"text-base font-semibold tracking-tight " + (isDarkMode ? 'text-white' : 'text-gray-900')}>
              9. Changes
            </h2>
            <p className="mt-2">
              We may update this Privacy Policy from time to time. Continued use of the Service after an update means you
              accept the updated Privacy Policy.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
