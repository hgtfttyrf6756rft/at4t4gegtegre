
/**
 * Common free email providers to exclude from "Work Email" detection.
 * This list covers major global and regional providers.
 */
export const FREE_EMAIL_PROVIDERS = new Set([
    'gmail.com',
    'yahoo.com',
    'hotmail.com',
    'outlook.com',
    'aol.com',
    'icloud.com',
    'me.com',
    'mac.com',
    'protonmail.com',
    'proton.me',
    'zoho.com', // Zoho has a free tier, but often used for business. This is a tradeoff. 
    // Often companies will use custom domains on Zoho. 
    // If it's @zoho.com, it's likely a generic/free account.
    'yandex.com',
    'yandex.ru',
    'mail.ru',
    'gmx.com',
    'gmx.de',
    'web.de',
    'live.com',
    'msn.com',
    'comcast.net',
    'sbcglobal.net',
    'verizon.net',
    'att.net',
    'bellsouth.net',
]);

/**
 * disposable email domains can be added here or checked via an external API if stricter checks are needed.
 */

/**
 * Checks if an email address is likely a work/company email.
 * It does this by checking the domain against a known list of free/public email providers.
 * 
 * @param email The email address to check
 * @returns true if it appears to be a work email, false otherwise.
 */
export const isWorkEmail = (email: string): boolean => {
    if (!email || !email.includes('@')) {
        return false;
    }

    const domain = email.split('@')[1].toLowerCase().trim();

    // 1. Check if it's in the free providers list
    if (FREE_EMAIL_PROVIDERS.has(domain)) {
        return false;
    }

    // 2. (Optional) formatting checks - e.g. reject if no dot in domain
    if (!domain.includes('.')) {
        return false;
    }

    // If it's not a known free provider, we assume it's a work/custom domain.
    return true;
};

/**
 * Extracts the domain from an email address.
 */
export const getEmailDomain = (email: string): string | null => {
    if (!email || !email.includes('@')) return null;
    return email.split('@')[1].toLowerCase().trim();
};
