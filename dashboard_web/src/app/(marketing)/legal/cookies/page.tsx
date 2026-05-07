import LegalPage from "@/components/marketing/legal-page"

export default function CookiesPage() {
  return (
    <LegalPage title="Cookie Policy" lastUpdated="May 7, 2026">
      <p>This Cookie Policy explains how Go-Data uses cookies and similar technologies on go-data.co and the Go-Data dashboard.</p>

      <h2>What are cookies?</h2>
      <p>Cookies are small text files stored on your device when you visit a website. They allow the site to remember preferences and recognize you on subsequent visits.</p>

      <h2>Categories of cookies we use</h2>
      <h3>Essential</h3>
      <p>Required to operate the Service: session cookies, CSRF protection, authentication. Cannot be disabled.</p>
      <h3>Analytics</h3>
      <p>Help us understand how the Service is used so we can improve it. We use privacy-friendly analytics (PostHog, EU-hosted) and respect Do Not Track.</p>
      <h3>Marketing</h3>
      <p>Help us measure ad effectiveness on our marketing website. Disabled by default in EU/UK/CA. Always opt-in.</p>

      <h2>Manage your preferences</h2>
      <p>You can adjust your cookie preferences any time using the banner displayed on first visit, or via your browser settings.</p>

      <h2>Third-party cookies</h2>
      <p>Some services we use may set their own cookies, including Stripe (payments), Cloudflare (security), Vercel (hosting). See their respective policies for details.</p>

      <h2>Contact</h2>
      <p>Questions? Email <a href="mailto:privacy@go-data.co">privacy@go-data.co</a>.</p>
    </LegalPage>
  )
}
