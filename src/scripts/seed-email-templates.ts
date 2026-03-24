import { EMAIL_TEMPLATES_MODULE } from "../modules/email_templates";
import { MedusaError } from "@medusajs/framework/utils";

const emailTemplatesData = [
  {
    name: "Order Confirmation",
    template_key: "order-placed",
    from: "orders@jyt.com",
    subject: "Order Confirmation - Order #{{order_display_id}}",
    html_content: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
        <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <h1 style="color: #28a745; font-size: 24px; margin-bottom: 20px;">Order Confirmation</h1>
          <p style="color: #333333; font-size: 16px; margin-bottom: 15px;">
            Hi {{customer_first_name}},
          </p>
          <p style="color: #666666; font-size: 16px; line-height: 1.5; margin-bottom: 20px;">
            Thank you for your order! We have received your order and will process it shortly.
          </p>
          <div style="margin-top: 20px; padding: 15px; background-color: #f8f9fa; border-radius: 4px;">
            <h3 style="color: #333333; font-size: 18px; margin-bottom: 10px;">Order #{{order_display_id}}</h3>
            <p style="color: #666666; font-size: 14px;">Total: {{order_total}}</p>
            <p style="color: #666666; font-size: 14px;">Email: {{order_email}}</p>
          </div>
          <p style="color: #999999; font-size: 14px; margin-top: 20px;">
            We'll send you another email when your order ships.
          </p>
        </div>
      </div>
    `,
    variables: {
      customer_first_name: "Customer's first name",
      order_display_id: "Order display ID",
      order_total: "Order total amount",
      order_email: "Customer email"
    },
    template_type: "order_confirmation",
    is_active: true
  },
  {
    name: "Password Reset",
    template_key: "password-reset",
    from: "security@jyt.com",
    subject: "Password Reset Request",
    html_content: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
        <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <h1 style="color: #333333; font-size: 24px; margin-bottom: 20px;">Password Reset</h1>
          <p style="color: #666666; font-size: 16px; line-height: 1.5; margin-bottom: 20px;">
            You have requested to reset your password. Please click the link below to reset your password.
          </p>
          <div style="margin: 30px 0; text-align: center;">
            <a href="{{reset_url}}" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block; font-weight: bold;">
              Reset Password
            </a>
          </div>
          <p style="color: #999999; font-size: 14px; margin-top: 20px;">
            If you did not request this password reset, please ignore this email.
          </p>
          <p style="color: #999999; font-size: 12px; margin-top: 10px;">
            This link will expire in 24 hours for security reasons.
          </p>
        </div>
      </div>
    `,
    variables: {
      reset_url: "Password reset URL with token"
    },
    template_type: "password_reset",
    is_active: true
  },
  {
    name: "Welcome Email",
    template_key: "customer-created",
    from: "welcome@jyt.com",
    subject: "Welcome to {{company_name}}!",
    html_content: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
        <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <h1 style="color: #28a745; font-size: 24px; margin-bottom: 20px;">Welcome!</h1>
          <p style="color: #333333; font-size: 16px; margin-bottom: 15px;">
            Hi {{customer_name}},
          </p>
          <p style="color: #666666; font-size: 16px; line-height: 1.5; margin-bottom: 20px;">
            Welcome to our store! Your account has been successfully created. You can now start shopping and enjoy our services.
          </p>
          <div style="margin: 30px 0; text-align: center;">
            <a href="{{store_url}}" style="background-color: #28a745; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block; font-weight: bold;">
              Start Shopping
            </a>
          </div>
          <p style="color: #999999; font-size: 14px; margin-top: 20px;">
            If you have any questions, feel free to contact our support team.
          </p>
        </div>
      </div>
    `,
    variables: {
      customer_name: "Customer's name",
      company_name: "Company name",
      store_url: "Store URL"
    },
    template_type: "customer_created",
    is_active: true
  },
  {
    name: "General Notification",
    template_key: "general",
    from: "notifications@jyt.com",
    subject: "{{title}}",
    html_content: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
        <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <h1 style="color: #333333; font-size: 24px; margin-bottom: 20px;">{{title}}</h1>
          <p style="color: #666666; font-size: 16px; line-height: 1.5; margin-bottom: 20px;">
            {{message}}
          </p>
          {{#if additional_content}}
          <div style="margin-top: 20px; padding: 15px; background-color: #f8f9fa; border-radius: 4px; font-size: 14px; color: #495057;">
            {{additional_content}}
          </div>
          {{/if}}
        </div>
      </div>
    `,
    variables: {
      title: "Notification title",
      message: "Notification message",
      additional_content: "Optional additional content"
    },
    template_type: "general",
    is_active: true
  },
  {
    name: "Blog Subscriber Email",
    template_key: "blog-subscriber",
    from: "blog@jyt.com",
    subject: "New Blog Post: {{blog_title}}",
    html_content: `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>{{blog_title}} - Jaal Yantra Textiles</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8f9fa;">
        <div style="max-width: 680px; margin: 0 auto; background-color: #ffffff;">
          
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 30px; text-align: center;">
            <h1 style="color: #ffffff; font-size: 32px; font-weight: 700; margin: 0 0 10px 0; text-shadow: 0 2px 4px rgba(0,0,0,0.3);">
              Jaal Yantra Textiles
            </h1>
            <p style="color: #e8eaff; font-size: 16px; margin: 0; opacity: 0.9;">
              Premium Textiles & Fashion Blog
            </p>
          </div>

          <!-- Personal Greeting -->
          <div style="padding: 30px; border-bottom: 1px solid #e9ecef;">
            <p style="color: #495057; font-size: 18px; margin: 0; line-height: 1.5;">
              Hello {{first_name}},
            </p>
            <p style="color: #6c757d; font-size: 16px; margin: 15px 0 0 0; line-height: 1.6;">
              We have a new blog post that we think you'll love. Here's what's fresh from our textile world:
            </p>
          </div>

          <!-- Blog Content -->
          <div style="padding: 40px 30px;">
            <!-- Blog Title -->
            <h2 style="color: #212529; font-size: 28px; font-weight: 600; margin: 0 0 20px 0; line-height: 1.3;">
              {{blog_title}}
            </h2>
            
            <!-- Blog Content -->
            <div style="color: #495057; font-size: 16px; line-height: 1.7; margin-bottom: 30px;">
              {{{blog_content}}}
            </div>
            
            <!-- Read More Button -->
            <div style="text-align: center; margin: 40px 0;">
              <a href="{{blog_url}}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4); transition: all 0.3s ease;">
                Read Full Article →
              </a>
            </div>
            
            <!-- Blog Tags -->
            {{#if blog_tags}}
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e9ecef;">
              <p style="color: #6c757d; font-size: 14px; margin: 0 0 10px 0; font-weight: 500;">
                Topics:
              </p>
              <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                {{#each blog_tags}}
                <span style="background-color: #e9ecef; color: #495057; padding: 4px 12px; border-radius: 16px; font-size: 12px; font-weight: 500;">
                  {{this}}
                </span>
                {{/each}}
              </div>
            </div>
            {{/if}}
          </div>

          <!-- Footer -->
          <div style="background-color: #f8f9fa; padding: 30px; text-align: center; border-top: 1px solid #e9ecef;">
            <div style="margin-bottom: 20px;">
              <h3 style="color: #495057; font-size: 18px; margin: 0 0 10px 0; font-weight: 600;">
                Stay Connected
              </h3>
              <p style="color: #6c757d; font-size: 14px; margin: 0; line-height: 1.5;">
                Follow us for more insights into the world of premium textiles and fashion.
              </p>
            </div>
            
            <!-- Social Links Placeholder -->
            <div style="margin-bottom: 25px;">
              <a href="{{website_url}}" style="color: #667eea; text-decoration: none; font-weight: 500; font-size: 14px;">
                Visit Our Website
              </a>
            </div>
            
            <!-- Unsubscribe -->
            <div style="border-top: 1px solid #dee2e6; padding-top: 20px;">
              <p style="color: #6c757d; font-size: 12px; margin: 0 0 8px 0; line-height: 1.4;">
                You're receiving this email because you subscribed to our blog updates.
              </p>
              <p style="color: #6c757d; font-size: 12px; margin: 0; line-height: 1.4;">
                <a href="{{unsubscribe_url}}" style="color: #6c757d; text-decoration: underline;">
                  Unsubscribe
                </a> | 
                &copy; {{current_year}} Jaal Yantra Textiles. All rights reserved.
              </p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `,
    variables: {
      blog_title: "Blog post title",
      blog_content: "Blog post HTML content from TipTap editor",
      blog_url: "URL to the full blog post",
      blog_tags: "Array of blog tags",
      first_name: "Subscriber's first name",
      last_name: "Subscriber's last name",
      email: "Subscriber's email address",
      unsubscribe_url: "URL to unsubscribe from blog emails",
      website_url: "Main website URL",
      current_year: "Current year for copyright"
    },
    template_type: "blog_subscriber",
    is_active: true
  },
  {
    name: "Agreement Invitation",
    template_key: "agreement-invitation",
    from: "agreements@jyt.com",
    subject: "Agreement Review Required: {{agreement_title}}",
    html_content: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
        <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <!-- Header -->
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #333333; font-size: 24px; margin-bottom: 10px;">Agreement Review Required</h1>
            <p style="color: #666666; font-size: 16px; margin: 0;">{{agreement_title}}</p>
          </div>
          
          <!-- Greeting -->
          <p style="color: #333333; font-size: 16px; margin-bottom: 15px;">
            Hello {{first_name}} {{last_name}},
          </p>
          
          <!-- Main Content -->
          <p style="color: #666666; font-size: 16px; line-height: 1.5; margin-bottom: 20px;">
            You have been invited to review and respond to an important agreement. Please take a moment to review the details and provide your response.
          </p>
          
          <!-- Agreement Details -->
          <div style="margin: 25px 0; padding: 20px; background-color: #f8f9fa; border-radius: 6px; border-left: 4px solid #007bff;">
            <h3 style="color: #333333; font-size: 18px; margin: 0 0 10px 0;">{{agreement_title}}</h3>
            <p style="color: #666666; font-size: 14px; margin: 0 0 8px 0;"><strong>Subject:</strong> {{agreement_subject}}</p>
            {{#if agreement_content}}
            <p style="color: #666666; font-size: 14px; margin: 0 0 8px 0;"><strong>Content:</strong> {{{agreement_content}}}</p>
            {{/if}}
          </div>
          
          <!-- Call to Action -->
          <div style="margin: 35px 0; text-align: center;">
            <a href="{{agreement_url}}" style="background: linear-gradient(135deg, #007bff 0%, #0056b3 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold; font-size: 16px; box-shadow: 0 2px 4px rgba(0,123,255,0.3); transition: all 0.3s ease;">
              View Agreement
            </a>
          </div>
          
          <!-- Additional Instructions -->
          <div style="margin-top: 25px; padding: 15px; background-color: #fff3cd; border-radius: 4px; border: 1px solid #ffeaa7;">
            <p style="color: #856404; font-size: 14px; margin: 0; line-height: 1.5;">
              <strong>Important:</strong> Please review the agreement carefully and provide your response. If you have any questions or concerns, please contact us.
            </p>
          </div>
          
          <!-- Footer -->
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e9ecef;">
            <p style="color: #999999; font-size: 12px; margin: 0; line-height: 1.4;">
              This agreement invitation was sent to {{email}}. If you received this email in error, please contact us immediately.
            </p>
            <p style="color: #999999; font-size: 12px; margin: 8px 0 0 0; line-height: 1.4;">
              &copy; {{current_year}} Jaal Yantra Textiles. All rights reserved. | <a href="{{website_url}}" style="color: #999999;">{{website_url}}</a>
            </p>
          </div>
        </div>
      </div>
    `,
    variables: {
      agreement_title: "Agreement title",
      agreement_content: "Agreement HTML content",
      agreement_subject: "Agreement subject/description", 
      agreement_id: "Agreement ID",
      first_name: "Person's first name",
      last_name: "Person's last name",
      email: "Person's email address",
      person_id: "Person ID",
      response_id: "Agreement response ID",
      agreement_url: "URL to view and respond to the agreement with access token",
      website_url: "Main website URL",
      current_year: "Current year for copyright"
    },
    template_type: "agreement_invitation",
    is_active: true
  },
    {
    name: "Shipment Shipped",
    template_key: "order-shipment-created",
    from: "orders@jyt.com",
    subject: "Your order {{order_id}} just shipped 🚚",
    html_content: `
      <!doctype html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <style>
            html, body { margin: 0; padding: 0; }
            body { width: 100% !important; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
            table { border-collapse: collapse; }
            img { border: 0; outline: none; text-decoration: none; }
            * { box-sizing: border-box; }

            .font-sans { font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; }
            .w-full { width: 100%; }
            .max-w-2xl { max-width: 672px; }
            .mx-auto { margin-left: auto; margin-right: auto; }

            .bg-white { background-color: #ffffff; }
            .bg-slate-50 { background-color: #f8fafc; }
            .bg-slate-100 { background-color: #f1f5f9; }
            .bg-slate-900 { background-color: #0f172a; }
            .bg-indigo-900 { background-color: #312e81; }

            .text-white { color: #ffffff; }
            .text-slate-900 { color: #0f172a; }
            .text-slate-800 { color: #1f2937; }
            .text-slate-700 { color: #334155; }
            .text-slate-600 { color: #475569; }
            .text-slate-500 { color: #64748b; }
            .text-slate-200 { color: #e2e8f0; }
            .text-indigo-200 { color: #c7d2fe; }
            .text-indigo-600 { color: #4f46e5; }

            .text-xs { font-size: 12px; line-height: 16px; }
            .text-sm { font-size: 14px; line-height: 20px; }
            .text-base { font-size: 16px; line-height: 24px; }
            .text-3xl { font-size: 30px; line-height: 36px; }

            .font-medium { font-weight: 500; }
            .font-semibold { font-weight: 600; }

            .uppercase { text-transform: uppercase; }
            .tracking-wide { letter-spacing: 0.025em; }
            .tracking-widest { letter-spacing: 0.1em; }

            .leading-relaxed { line-height: 1.625; }

            .p-4 { padding: 16px; }
            .p-6 { padding: 24px; }
            .p-8 { padding: 32px; }
            .px-3 { padding-left: 12px; padding-right: 12px; }
            .px-4 { padding-left: 16px; padding-right: 16px; }
            .px-5 { padding-left: 20px; padding-right: 20px; }
            .px-6 { padding-left: 24px; padding-right: 24px; }
            .py-1 { padding-top: 4px; padding-bottom: 4px; }
            .py-2 { padding-top: 8px; padding-bottom: 8px; }
            .py-4 { padding-top: 16px; padding-bottom: 16px; }
            .py-10 { padding-top: 40px; padding-bottom: 40px; }

            .mt-1 { margin-top: 4px; }
            .mt-3 { margin-top: 12px; }
            .mt-6 { margin-top: 24px; }
            .mt-8 { margin-top: 32px; }
            .mt-10 { margin-top: 40px; }
            .mb-2 { margin-bottom: 8px; }

            .rounded-full { border-radius: 9999px; }
            .rounded-xl { border-radius: 12px; }
            .rounded-2xl { border-radius: 16px; }

            .border { border-width: 1px; border-style: solid; }
            .border-slate-200 { border-color: #e2e8f0; }
            .border-t { border-top-width: 1px; border-top-style: solid; }
            .border-b { border-bottom-width: 1px; border-bottom-style: solid; }

            .text-left { text-align: left; }
            .text-right { text-align: right; }
            .text-center { text-align: center; }
            .align-top { vertical-align: top; }

            .inline-flex { display: inline-flex; }
            .flex { display: flex; }
            .flex-wrap { flex-wrap: wrap; }
            .items-center { align-items: center; }
            .justify-between { justify-content: space-between; }

            .shadow-xl { box-shadow: 0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04); }
          </style>
        </head>
        <body class="bg-slate-100 font-sans" style="margin:0; padding:0;">
      <div class="bg-slate-100 py-10">
        <table class="w-full max-w-2xl mx-auto bg-white shadow-xl rounded-2xl overflow-hidden font-sans">
          <thead>
            <tr class="bg-slate-900">
              <th class="p-8 text-left">
                <p class="text-sm uppercase tracking-widest text-indigo-200">Jaal Yantra Textiles</p>
                <h1 class="text-white text-3xl font-semibold mt-3">Shipment update</h1>
                <p class="text-slate-200 text-sm mt-1">Order {{order_id}} • {{formatDate order_date}}</p>
              </th>
              <th class="p-8 text-right align-top">
                <span class="inline-flex items-center px-4 py-2 rounded-full text-xs font-semibold text-white {{status_badge_class}}">
                  {{capitalize shipment_status}}
                </span>
              </th>
            </tr>
          </thead>

          <tbody>
            <tr>
              <td colspan="2" class="p-8">
                <p class="text-slate-700 text-base leading-relaxed">{{status_copy}}</p>

                {{#if tracking_numbers.length}}
                <div class="mt-8">
                  <p class="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">Tracking numbers</p>
                  <div class="flex flex-wrap gap-2">
                    {{#each tracking_numbers}}
                      <span class="px-3 py-1 text-sm font-medium bg-slate-100 text-slate-700 rounded-full">{{this}}</span>
                    {{/each}}
                  </div>
                </div>
                {{/if}}

                {{#if tracking_links.length}}
                <div class="mt-6 space-y-3">
                  {{#each tracking_links}}
                    <a href="{{url}}" class="flex items-center justify-between px-5 py-4 border border-slate-200 rounded-xl hover:border-indigo-500 transition-colors">
                      <span>
                        <p class="text-sm text-slate-500 uppercase tracking-wide">{{label}}</p>
                        <p class="text-base font-semibold text-slate-800">{{url}}</p>
                      </span>
                      <span class="text-indigo-600 text-sm font-semibold">Track →</span>
                    </a>
                  {{/each}}
                </div>
                {{/if}}

                <div class="mt-10 bg-slate-50 rounded-2xl">
                  <div class="px-6 py-4 border-b border-slate-200 flex justify-between text-xs font-semibold text-slate-500 uppercase tracking-widest">
                    <span>Items in this shipment</span>
                    <span>Qty</span>
                  </div>
                  {{#each items}}
                  <div class="px-6 py-4 flex justify-between items-center border-b border-slate-200 last:border-0">
                    <div>
                      <p class="text-slate-900 font-medium">{{title}}</p>
                      {{#if sku}}
                        <p class="text-xs text-slate-500 mt-1">SKU: {{sku}}</p>
                      {{/if}}
                    </div>
                    <p class="text-slate-700 font-semibold">{{quantity}}</p>
                  </div>
                  {{/each}}
                </div>

                <div class="mt-10 grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div class="p-6 border border-slate-200 rounded-2xl">
                    <p class="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">Shipping to</p>
                    <p class="text-slate-900 font-semibold">{{shipping_address.first_name}} {{shipping_address.last_name}}</p>
                    <p class="text-slate-600 text-sm leading-relaxed mt-1">
                      {{shipping_address.address_1}}<br/>
                      {{#if shipping_address.address_2}}{{shipping_address.address_2}}<br/>{{/if}}
                      {{shipping_address.city}}, {{shipping_address.postal_code}}<br/>
                      {{shipping_address.country_code}}
                    </p>
                    {{#if shipping_address.phone}}
                      <p class="text-slate-500 text-sm mt-3">Phone: {{shipping_address.phone}}</p>
                    {{/if}}
                  </div>

                  <div class="p-6 border border-slate-200 rounded-2xl bg-slate-50">
                    <p class="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">Order summary</p>
                    <dl class="space-y-2 text-sm text-slate-600">
                      <div class="flex justify-between">
                        <dt>Subtotal</dt>
                        <dd>{{formatMoney order_totals.currency_code order_totals.subtotal}}</dd>
                      </div>
                      <div class="flex justify-between">
                        <dt>Shipping</dt>
                        <dd>{{formatMoney order_totals.currency_code order_totals.shipping_total}}</dd>
                      </div>
                      <div class="flex justify-between">
                        <dt>Tax</dt>
                        <dd>{{formatMoney order_totals.currency_code order_totals.tax_total}}</dd>
                      </div>
                      <div class="flex justify-between text-base font-semibold text-slate-900 pt-2 border-t border-slate-200">
                        <dt>Total</dt>
                        <dd>{{formatMoney order_totals.currency_code order_totals.total}}</dd>
                      </div>
                    </dl>
                  </div>
                </div>

                <p class="mt-10 text-xs text-slate-500 text-center">
                  Need help? Reply to this email or reach us at support@jyt.com
                </p>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
        </body>
      </html>
    `,
    variables: {
      customer_name: "Customer name",
      order_id: "Order display ID",
      order_date: "ISO timestamp",
      status_copy: "Status description",
      status_badge_class: "Tailwind class for badge background",
      shipment_status: "'shipped' or 'delivered'",
      tracking_numbers: "Array<string>",
      tracking_links: "Array<{ url: string; label: string }>",
      items: "Array<{ id; title; sku; quantity }>",
      shipping_address: "Structured address object",
      order_totals: "Totals object with subtotal/shipping_total/tax_total/total/currency_code"
    },
    template_type: "shipment_update",
    is_active: true
  },
  {
    name: "Shipment Delivered",
    template_key: "order-shipment-delivered",
    from: "orders@jyt.com",
    subject: "Delivered: Order {{order_id}} 📦",
    html_content: `
      <!doctype html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <style>
            html, body { margin: 0; padding: 0; }
            body { width: 100% !important; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
            * { box-sizing: border-box; }

            .font-sans { font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; }
            .w-full { width: 100%; }
            .max-w-2xl { max-width: 672px; }
            .mx-auto { margin-left: auto; margin-right: auto; }

            .bg-white { background-color: #ffffff; }
            .bg-slate-50 { background-color: #f8fafc; }
            .bg-slate-900 { background-color: #0f172a; }
            .bg-emerald-50 { background-color: #ecfdf5; }
            .bg-emerald-600 { background-color: #059669; }

            .text-white { color: #ffffff; }
            .text-slate-900 { color: #0f172a; }
            .text-slate-700 { color: #334155; }
            .text-slate-600 { color: #475569; }
            .text-slate-500 { color: #64748b; }
            .text-slate-400 { color: #94a3b8; }
            .text-emerald-200 { color: #a7f3d0; }
            .text-emerald-100 { color: #d1fae5; }
            .text-emerald-600 { color: #059669; }

            .text-xs { font-size: 12px; line-height: 16px; }
            .text-sm { font-size: 14px; line-height: 20px; }
            .text-lg { font-size: 18px; line-height: 28px; }
            .text-4xl { font-size: 36px; line-height: 40px; }

            .font-semibold { font-weight: 600; }

            .uppercase { text-transform: uppercase; }
            .tracking-widest { letter-spacing: 0.1em; }

            .leading-relaxed { line-height: 1.625; }

            .p-4 { padding: 16px; }
            .p-6 { padding: 24px; }
            .p-8 { padding: 32px; }
            .p-10 { padding: 40px; }
            .py-10 { padding-top: 40px; padding-bottom: 40px; }
            .mt-2 { margin-top: 8px; }
            .mt-5 { margin-top: 20px; }
            .mt-10 { margin-top: 40px; }
            .mt-12 { margin-top: 48px; }
            .mb-2 { margin-bottom: 8px; }
            .mb-3 { margin-bottom: 12px; }

            .rounded-2xl { border-radius: 16px; }
            .rounded-3xl { border-radius: 24px; }
            .rounded-full { border-radius: 9999px; }

            .border { border-width: 1px; border-style: solid; }
            .border-slate-100 { border-color: #f1f5f9; }
            .border-slate-200 { border-color: #e2e8f0; }
            .border-emerald-100 { border-color: #d1fae5; }

            .text-center { text-align: center; }
            .flex { display: flex; }
            .items-start { align-items: flex-start; }
            .items-center { align-items: center; }
            .justify-between { justify-content: space-between; }
            .shadow-2xl { box-shadow: 0 25px 50px -12px rgba(0,0,0,0.25); }
          </style>
        </head>
        <body class="bg-emerald-50 font-sans" style="margin:0; padding:0;">
      <div class="bg-emerald-50 py-10">
        <div class="max-w-2xl mx-auto bg-white rounded-3xl shadow-2xl overflow-hidden font-sans">
          <div class="bg-emerald-600 p-10 text-white">
            <p class="uppercase tracking-widest text-emerald-200 text-xs">Delivery confirmation</p>
            <h1 class="text-4xl font-semibold mt-2">It’s here!</h1>
            <p class="text-emerald-100 mt-2">Order {{order_id}} • Delivered on {{formatDate order_date}}</p>
          </div>

          <div class="p-10">
            <div class="bg-emerald-50 border border-emerald-100 rounded-2xl p-6 flex items-start gap-4">
              <span class="px-4 py-2 rounded-full text-xs font-semibold text-white {{status_badge_class}}">
                {{capitalize shipment_status}}
              </span>
              <p class="text-slate-700 leading-relaxed">{{status_copy}}</p>
            </div>

            <div class="mt-10 space-y-4">
              {{#each items}}
              <div class="flex items-center justify-between p-4 border border-slate-100 rounded-2xl">
                <div>
                  <p class="text-slate-900 font-semibold">{{title}}</p>
                  <p class="text-xs text-slate-500 mt-1">
                    {{#if sku}}SKU: {{sku}} • {{/if}}Qty {{quantity}}
                  </p>
                </div>
                <span class="text-emerald-600 text-sm font-semibold">Delivered</span>
              </div>
              {{/each}}
            </div>

            <div class="mt-12 grid gap-6 md:grid-cols-2">
              <div class="border border-slate-100 rounded-2xl p-6">
                <p class="text-xs uppercase tracking-[0.35em] text-slate-400 mb-3">Delivered to</p>
                <p class="text-slate-900 font-semibold">{{shipping_address.first_name}} {{shipping_address.last_name}}</p>
                <p class="text-slate-600 text-sm leading-relaxed mt-2">
                  {{shipping_address.address_1}}<br/>
                  {{#if shipping_address.address_2}}{{shipping_address.address_2}}<br/>{{/if}}
                  {{shipping_address.city}}, {{shipping_address.postal_code}}<br/>
                  {{shipping_address.country_code}}
                </p>
                {{#if shipping_address.phone}}
                  <p class="text-slate-500 text-sm mt-3">Phone: {{shipping_address.phone}}</p>
                {{/if}}
              </div>

              <div class="border border-slate-100 rounded-2xl p-6 bg-slate-50">
                <p class="text-xs uppercase tracking-[0.35em] text-slate-400 mb-3">Order recap</p>
                <p class="text-slate-600 text-sm leading-relaxed">Placed on {{formatDate order_date}}</p>
                <dl class="mt-5 space-y-2 text-sm text-slate-600">
                  <div class="flex justify-between">
                    <dt>Subtotal</dt>
                    <dd>{{formatMoney order_totals.currency_code order_totals.subtotal}}</dd>
                  </div>
                  <div class="flex justify-between">
                    <dt>Shipping</dt>
                    <dd>{{formatMoney order_totals.currency_code order_totals.shipping_total}}</dd>
                  </div>
                  <div class="flex justify-between">
                    <dt>Tax</dt>
                    <dd>{{formatMoney order_totals.currency_code order_totals.tax_total}}</dd>
                  </div>
                  <div class="flex justify-between text-base font-semibold text-slate-900 pt-3 border-t border-slate-200">
                    <dt>Total</dt>
                    <dd>{{formatMoney order_totals.currency_code order_totals.total}}</dd>
                  </div>
                </dl>
              </div>
            </div>

            <div class="mt-12 bg-slate-900 rounded-2xl p-8 text-white">
              <p class="text-lg font-semibold mb-2">How did we do?</p>
              <p class="text-slate-200 text-sm leading-relaxed">
                Your feedback helps us craft better experiences. If anything looks off, reply to this email and we’ll make it right.
              </p>
            </div>

            <p class="mt-10 text-xs text-center text-slate-400">
              © {{formatYear order_date}} Jaal Yantra Textiles • Crafted with care for you.
            </p>
          </div>
        </div>
      </div>
        </body>
      </html>
    `,
    variables: {
      customer_name: "Customer name",
      order_id: "Order display ID",
      order_date: "ISO timestamp",
      status_copy: "Status description",
      status_badge_class: "Tailwind class for badge background",
      shipment_status: "'shipped' or 'delivered'",
      items: "Array<{ title; sku; quantity }>",
      shipping_address: "Structured address object",
      order_totals: "Totals object with subtotal/shipping_total/tax_total/total/currency_code"
    },
    template_type: "shipment_update",
    is_active: true
  },
  {
    name: "Design Assigned to Customer",
    template_key: "design-assigned",
    from: "designs@jyt.com",
    subject: "Your custom design is ready: {{design_name}}",
    html_content: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
        <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <h1 style="color: #6366f1; font-size: 24px; margin-bottom: 20px;">Your Design Is Ready</h1>
          <p style="color: #333333; font-size: 16px; margin-bottom: 15px;">
            Hi {{customer_name}},
          </p>
          <p style="color: #666666; font-size: 16px; line-height: 1.5; margin-bottom: 20px;">
            Our design team has created a personalised design brief for you: <strong>{{design_name}}</strong>.
          </p>
          <p style="color: #666666; font-size: 15px; line-height: 1.5; margin-bottom: 24px;">
            Log in to your account to view the design details, explore the moodboard, and open the interactive design editor to customise it further.
          </p>
          {{#if design_url}}
          <div style="margin: 30px 0; text-align: center;">
            <a href="{{design_url}}" style="background-color: #6366f1; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold; font-size: 16px;">
              Open Design Editor
            </a>
          </div>
          {{/if}}
          <div style="margin-top: 20px; padding: 16px; background-color: #f0f0ff; border-radius: 6px; border-left: 4px solid #6366f1;">
            <p style="color: #4338ca; font-size: 14px; margin: 0; line-height: 1.5;">
              <strong>Design:</strong> {{design_name}}<br/>
              {{#if design_status}}<strong>Status:</strong> {{design_status}}{{/if}}
            </p>
          </div>
          <p style="color: #999999; font-size: 14px; margin-top: 24px; line-height: 1.5;">
            If you have any questions about your design, reply to this email or contact our support team.
          </p>
        </div>
      </div>
    `,
    variables: {
      customer_name: "Customer's first name",
      design_name: "Name of the assigned design",
      design_url: "URL to the design editor (optional)",
      design_status: "Current status of the design (optional)",
    },
    template_type: "design_assigned",
    is_active: true
  },
  // ── Design Creation ────────────────────────────────────────────────
  {
    name: "Design Created Notification",
    template_key: "design-created",
    from: "designs@jyt.com",
    subject: "New design created: {{design_name}}",
    html_content: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
        <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <h1 style="color: #6366f1; font-size: 24px; margin-bottom: 20px;">New Design Created</h1>
          <p style="color: #333333; font-size: 16px; margin-bottom: 15px;">Hi {{partner_name}},</p>
          <p style="color: #666666; font-size: 16px; line-height: 1.5; margin-bottom: 20px;">
            A new design has been created and assigned to your workspace.
          </p>
          <div style="margin: 20px 0; padding: 20px; background-color: #f0f0ff; border-radius: 6px; border-left: 4px solid #6366f1;">
            <h3 style="color: #4338ca; font-size: 18px; margin: 0 0 8px 0;">{{design_name}}</h3>
            <p style="color: #666666; font-size: 14px; margin: 4px 0;"><strong>Type:</strong> {{design_type}}</p>
            <p style="color: #666666; font-size: 14px; margin: 4px 0;"><strong>Priority:</strong> {{design_priority}}</p>
            <p style="color: #666666; font-size: 14px; margin: 4px 0;"><strong>Status:</strong> {{design_status}}</p>
            {{#if target_date}}<p style="color: #666666; font-size: 14px; margin: 4px 0;"><strong>Target Date:</strong> {{target_date}}</p>{{/if}}
          </div>
          {{#if design_url}}
          <div style="margin: 30px 0; text-align: center;">
            <a href="{{design_url}}" style="background-color: #6366f1; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">
              View Design
            </a>
          </div>
          {{/if}}
          <p style="color: #999999; font-size: 14px; margin-top: 24px;">
            Log in to your partner dashboard to review the design details and start working on it.
          </p>
        </div>
      </div>
    `,
    variables: {
      partner_name: "Partner's name",
      design_name: "Design name/title",
      design_type: "Design type (e.g., Fabric, Print, Weave)",
      design_priority: "Priority level (low, medium, high, urgent)",
      design_status: "Current status",
      target_date: "Target completion date (optional)",
      design_url: "URL to the design in partner dashboard (optional)",
    },
    template_type: "design_created",
    is_active: true
  },
  {
    name: "Design Status Updated",
    template_key: "design-status-updated",
    from: "designs@jyt.com",
    subject: "Design update: {{design_name}} is now {{design_status}}",
    html_content: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
        <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <h1 style="color: #333333; font-size: 24px; margin-bottom: 20px;">Design Status Update</h1>
          <p style="color: #333333; font-size: 16px; margin-bottom: 15px;">Hi {{recipient_name}},</p>
          <p style="color: #666666; font-size: 16px; line-height: 1.5; margin-bottom: 20px;">
            The design <strong>{{design_name}}</strong> has been updated.
          </p>
          <div style="margin: 20px 0; padding: 20px; background-color: #f8f9fa; border-radius: 6px;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; color: #666666; font-size: 14px; width: 140px;"><strong>Previous Status:</strong></td>
                <td style="padding: 8px 0; color: #999999; font-size: 14px;">{{previous_status}}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #666666; font-size: 14px;"><strong>New Status:</strong></td>
                <td style="padding: 8px 0; font-size: 14px;">
                  <span style="background-color: #e0f2fe; color: #0369a1; padding: 4px 12px; border-radius: 12px; font-weight: 600;">{{design_status}}</span>
                </td>
              </tr>
              {{#if updated_by}}<tr>
                <td style="padding: 8px 0; color: #666666; font-size: 14px;"><strong>Updated By:</strong></td>
                <td style="padding: 8px 0; color: #333333; font-size: 14px;">{{updated_by}}</td>
              </tr>{{/if}}
            </table>
          </div>
          {{#if design_url}}
          <div style="margin: 30px 0; text-align: center;">
            <a href="{{design_url}}" style="background-color: #0369a1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">
              View Design
            </a>
          </div>
          {{/if}}
        </div>
      </div>
    `,
    variables: {
      recipient_name: "Recipient's name (partner or admin)",
      design_name: "Design name",
      previous_status: "Previous status",
      design_status: "New status",
      updated_by: "Name of user who updated (optional)",
      design_url: "URL to the design (optional)",
    },
    template_type: "design_status_updated",
    is_active: true
  },
  {
    name: "Design Inventory Linked",
    template_key: "design-inventory-linked",
    from: "designs@jyt.com",
    subject: "Materials assigned to your design: {{design_name}}",
    html_content: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
        <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <h1 style="color: #333333; font-size: 24px; margin-bottom: 20px;">Materials Assigned</h1>
          <p style="color: #333333; font-size: 16px; margin-bottom: 15px;">Hi {{customer_name}},</p>
          <p style="color: #666666; font-size: 16px; line-height: 1.5; margin-bottom: 20px;">
            Inventory materials have been linked to your design <strong>{{design_name}}</strong>. This means your design is progressing toward production.
          </p>
          <div style="margin: 20px 0; padding: 20px; background-color: #f0fdf4; border-radius: 6px; border-left: 4px solid #16a34a;">
            <p style="color: #15803d; font-size: 14px; margin: 0;"><strong>Current Status:</strong> {{design_status}}</p>
          </div>
          {{#if design_url}}
          <div style="margin: 30px 0; text-align: center;">
            <a href="{{design_url}}" style="background-color: #0369a1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">
              View Design
            </a>
          </div>
          {{/if}}
        </div>
      </div>
    `,
    variables: {
      customer_name: "Customer's name",
      design_name: "Design name",
      design_status: "Current design status",
      design_url: "URL to the design (optional)",
    },
    template_type: "design_inventory_linked",
    is_active: true
  },
  {
    name: "Design Production Started",
    template_key: "design-production-started",
    from: "designs@jyt.com",
    subject: "Production has started for your design: {{design_name}}",
    html_content: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
        <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <h1 style="color: #333333; font-size: 24px; margin-bottom: 20px;">Production Started</h1>
          <p style="color: #333333; font-size: 16px; margin-bottom: 15px;">Hi {{customer_name}},</p>
          <p style="color: #666666; font-size: 16px; line-height: 1.5; margin-bottom: 20px;">
            Great news! Production has officially started for your design <strong>{{design_name}}</strong>. Our production partner is now working on bringing your design to life.
          </p>
          <div style="margin: 20px 0; padding: 20px; background-color: #eff6ff; border-radius: 6px; border-left: 4px solid #2563eb;">
            <p style="color: #1e40af; font-size: 14px; margin: 0;"><strong>Status:</strong> In Production</p>
          </div>
          {{#if design_url}}
          <div style="margin: 30px 0; text-align: center;">
            <a href="{{design_url}}" style="background-color: #0369a1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">
              View Design
            </a>
          </div>
          {{/if}}
        </div>
      </div>
    `,
    variables: {
      customer_name: "Customer's name",
      design_name: "Design name",
      design_url: "URL to the design (optional)",
    },
    template_type: "design_production_started",
    is_active: true
  },
  {
    name: "Design Production Completed",
    template_key: "design-production-completed",
    from: "designs@jyt.com",
    subject: "Production complete for your design: {{design_name}}",
    html_content: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
        <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <h1 style="color: #16a34a; font-size: 24px; margin-bottom: 20px;">Production Complete!</h1>
          <p style="color: #333333; font-size: 16px; margin-bottom: 15px;">Hi {{customer_name}},</p>
          <p style="color: #666666; font-size: 16px; line-height: 1.5; margin-bottom: 20px;">
            Your design <strong>{{design_name}}</strong> has completed production. It is now being prepared for the next steps.
          </p>
          <div style="margin: 20px 0; padding: 20px; background-color: #f0fdf4; border-radius: 6px; border-left: 4px solid #16a34a;">
            <p style="color: #15803d; font-size: 14px; margin: 0;"><strong>Status:</strong> Production Complete</p>
          </div>
          {{#if design_url}}
          <div style="margin: 30px 0; text-align: center;">
            <a href="{{design_url}}" style="background-color: #0369a1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">
              View Design
            </a>
          </div>
          {{/if}}
        </div>
      </div>
    `,
    variables: {
      customer_name: "Customer's name",
      design_name: "Design name",
      design_url: "URL to the design (optional)",
    },
    template_type: "design_production_completed",
    is_active: true
  },
  // ── Partner Order Emails ───────────────────────────────────────────
  {
    name: "Partner New Order",
    template_key: "partner-order-placed",
    from: "partner@partner.jaalyantra.com",
    subject: "New order received: #{{order_display_id}}",
    html_content: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
        <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <h1 style="color: #16a34a; font-size: 24px; margin-bottom: 20px;">New Order Received!</h1>
          <p style="color: #333333; font-size: 16px; margin-bottom: 15px;">Hi {{partner_name}},</p>
          <p style="color: #666666; font-size: 16px; line-height: 1.5; margin-bottom: 20px;">
            You have received a new order on your store <strong>{{store_name}}</strong>.
          </p>
          <div style="margin: 20px 0; padding: 20px; background-color: #f0fdf4; border-radius: 6px; border-left: 4px solid #16a34a;">
            <h3 style="color: #15803d; font-size: 18px; margin: 0 0 12px 0;">Order #{{order_display_id}}</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr><td style="padding: 4px 0; color: #666; font-size: 14px;"><strong>Customer:</strong></td><td style="padding: 4px 0; font-size: 14px;">{{customer_name}} ({{customer_email}})</td></tr>
              <tr><td style="padding: 4px 0; color: #666; font-size: 14px;"><strong>Total:</strong></td><td style="padding: 4px 0; font-size: 14px; font-weight: 600;">{{order_total}}</td></tr>
              <tr><td style="padding: 4px 0; color: #666; font-size: 14px;"><strong>Items:</strong></td><td style="padding: 4px 0; font-size: 14px;">{{item_count}} item(s)</td></tr>
              <tr><td style="padding: 4px 0; color: #666; font-size: 14px;"><strong>Payment:</strong></td><td style="padding: 4px 0; font-size: 14px;">{{payment_status}}</td></tr>
            </table>
          </div>
          {{#if items}}
          <div style="margin: 20px 0;">
            <h4 style="color: #333; font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px;">Order Items</h4>
            {{#each items}}
            <div style="display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #f0f0f0;">
              <span style="color: #333; font-size: 14px;">{{title}} × {{quantity}}</span>
              <span style="color: #666; font-size: 14px;">{{price}}</span>
            </div>
            {{/each}}
          </div>
          {{/if}}
          {{#if order_url}}
          <div style="margin: 30px 0; text-align: center;">
            <a href="{{order_url}}" style="background-color: #16a34a; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">
              View Order Details
            </a>
          </div>
          {{/if}}
          <p style="color: #999999; font-size: 14px; margin-top: 20px;">
            Please process this order as soon as possible. You can manage it from your partner dashboard.
          </p>
        </div>
      </div>
    `,
    variables: {
      partner_name: "Partner's name",
      store_name: "Store name",
      order_display_id: "Order display ID",
      customer_name: "Customer's full name",
      customer_email: "Customer's email",
      order_total: "Formatted total amount",
      item_count: "Number of items",
      payment_status: "Payment status (paid, pending, etc.)",
      items: "Array of { title, quantity, price }",
      order_url: "URL to order in partner dashboard (optional)",
    },
    template_type: "partner_order_placed",
    is_active: true
  },
  {
    name: "Partner Order Fulfilled",
    template_key: "partner-order-fulfilled",
    from: "partner@partner.jaalyantra.com",
    subject: "Order #{{order_display_id}} has been fulfilled",
    html_content: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
        <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <h1 style="color: #0369a1; font-size: 24px; margin-bottom: 20px;">Order Fulfilled</h1>
          <p style="color: #333333; font-size: 16px; margin-bottom: 15px;">Hi {{admin_first_name}},</p>
          <p style="color: #666666; font-size: 16px; line-height: 1.5; margin-bottom: 20px;">
            Order <strong>#{{order_display_id}}</strong> for <strong>{{customer_name}}</strong> has been fulfilled and is on its way.
          </p>
          {{#if tracking_number}}
          <div style="margin: 20px 0; padding: 20px; background-color: #f0f9ff; border-radius: 6px; border-left: 4px solid #0369a1;">
            <p style="color: #333; font-size: 14px; margin: 0 0 8px 0;"><strong>Tracking Number:</strong> {{tracking_number}}</p>
            <p style="color: #333; font-size: 14px; margin: 0 0 8px 0;"><strong>Carrier:</strong> {{carrier_name}}</p>
            {{#if tracking_url}}
            <a href="{{tracking_url}}" style="color: #0369a1; font-size: 14px; font-weight: 600; text-decoration: underline;">Track your shipment →</a>
            {{/if}}
          </div>
          {{/if}}
          <div style="margin: 20px 0; padding: 20px; background-color: #f8f9fa; border-radius: 6px;">
            <h4 style="color: #333; margin: 0 0 12px 0; font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em;">Shipping Address</h4>
            <p style="color: #666; font-size: 14px; line-height: 1.6; margin: 0;">
              {{shipping_address_line1}}<br/>
              {{#if shipping_address_line2}}{{shipping_address_line2}}<br/>{{/if}}
              {{shipping_city}}, {{shipping_postal_code}}<br/>
              {{shipping_country}}
            </p>
          </div>
          <p style="color: #999999; font-size: 14px; margin-top: 24px;">
            If you have questions about your order, you can reach {{store_name}} by replying to this email.
          </p>
        </div>
      </div>
    `,
    variables: {
      customer_name: "Customer's name",
      order_display_id: "Order display ID",
      store_name: "Partner store name",
      tracking_number: "Shipment tracking number (optional)",
      carrier_name: "Shipping carrier name (optional)",
      tracking_url: "Tracking URL (optional)",
      shipping_address_line1: "Address line 1",
      shipping_address_line2: "Address line 2 (optional)",
      shipping_city: "City",
      shipping_postal_code: "Postal code",
      shipping_country: "Country",
    },
    template_type: "partner_order_fulfilled",
    is_active: true
  },
  {
    name: "Partner Order Cancelled",
    template_key: "partner-order-cancelled",
    from: "partner@partner.jaalyantra.com",
    subject: "Order #{{order_display_id}} has been cancelled",
    html_content: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
        <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <h1 style="color: #dc2626; font-size: 24px; margin-bottom: 20px;">Order Cancelled</h1>
          <p style="color: #333333; font-size: 16px; margin-bottom: 15px;">Hi {{admin_first_name}},</p>
          <p style="color: #666666; font-size: 16px; line-height: 1.5; margin-bottom: 20px;">
            Order <strong>#{{order_display_id}}</strong> for <strong>{{customer_name}}</strong> has been cancelled.
          </p>
          {{#if cancellation_reason}}
          <div style="margin: 20px 0; padding: 16px; background-color: #fef2f2; border-radius: 6px; border-left: 4px solid #dc2626;">
            <p style="color: #991b1b; font-size: 14px; margin: 0;"><strong>Reason:</strong> {{cancellation_reason}}</p>
          </div>
          {{/if}}
          <div style="margin: 20px 0; padding: 16px; background-color: #f0fdf4; border-radius: 6px;">
            <p style="color: #15803d; font-size: 14px; margin: 0;">
              {{#if refund_amount}}<strong>Refund:</strong> {{refund_amount}} will be returned to your original payment method within 5-10 business days.{{else}}If you were charged, a refund will be processed automatically.{{/if}}
            </p>
          </div>
          <p style="color: #999999; font-size: 14px; margin-top: 24px;">
            If you have questions, reply to this email or contact our support team.
          </p>
        </div>
      </div>
    `,
    variables: {
      customer_name: "Customer's name",
      order_display_id: "Order display ID",
      store_name: "Partner store name",
      cancellation_reason: "Reason for cancellation (optional)",
      refund_amount: "Formatted refund amount (optional)",
    },
    template_type: "partner_order_cancelled",
    is_active: true
  },
  // ── Partner Notifications ──────────────────────────────────────────
  {
    name: "Partner Verified",
    template_key: "partner-verified",
    from: "partners@jyt.com",
    subject: "Congratulations! Your partner account is verified",
    html_content: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
        <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <div style="text-align: center; margin-bottom: 24px;">
            <div style="display: inline-block; background-color: #dcfce7; border-radius: 50%; padding: 16px; margin-bottom: 16px;">
              <span style="font-size: 32px;">✓</span>
            </div>
            <h1 style="color: #16a34a; font-size: 24px; margin: 0;">You're Verified!</h1>
          </div>
          <p style="color: #333333; font-size: 16px; margin-bottom: 15px;">Hi {{partner_name}},</p>
          <p style="color: #666666; font-size: 16px; line-height: 1.5; margin-bottom: 20px;">
            Your partner account has been verified. You now have full access to all partner features including:
          </p>
          <ul style="color: #666666; font-size: 14px; line-height: 2; padding-left: 20px; margin-bottom: 24px;">
            <li>Creating and managing products</li>
            <li>Receiving and fulfilling orders</li>
            <li>Setting up your own storefront</li>
            <li>Accessing design assignments</li>
            <li>Managing shipping and payments</li>
          </ul>
          {{#if dashboard_url}}
          <div style="margin: 30px 0; text-align: center;">
            <a href="{{dashboard_url}}" style="background-color: #16a34a; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">
              Go to Dashboard
            </a>
          </div>
          {{/if}}
        </div>
      </div>
    `,
    variables: {
      partner_name: "Partner's name",
      dashboard_url: "URL to partner dashboard (optional)",
    },
    template_type: "partner_verified",
    is_active: true
  },
  {
    name: "Partner Task Assigned",
    template_key: "partner-task-assigned",
    from: "tasks@jyt.com",
    subject: "New task assigned: {{task_title}}",
    html_content: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
        <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <h1 style="color: #333333; font-size: 24px; margin-bottom: 20px;">New Task Assigned</h1>
          <p style="color: #333333; font-size: 16px; margin-bottom: 15px;">Hi {{partner_name}},</p>
          <p style="color: #666666; font-size: 16px; line-height: 1.5; margin-bottom: 20px;">
            A new task has been assigned to you.
          </p>
          <div style="margin: 20px 0; padding: 20px; background-color: #fffbeb; border-radius: 6px; border-left: 4px solid #f59e0b;">
            <h3 style="color: #92400e; font-size: 18px; margin: 0 0 8px 0;">{{task_title}}</h3>
            {{#if task_description}}<p style="color: #666666; font-size: 14px; margin: 4px 0;">{{task_description}}</p>{{/if}}
            <p style="color: #666666; font-size: 14px; margin: 8px 0 0 0;">
              <strong>Priority:</strong> {{task_priority}} &nbsp;|&nbsp; <strong>Status:</strong> {{task_status}}
            </p>
          </div>
          {{#if task_url}}
          <div style="margin: 30px 0; text-align: center;">
            <a href="{{task_url}}" style="background-color: #f59e0b; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">
              View Task
            </a>
          </div>
          {{/if}}
        </div>
      </div>
    `,
    variables: {
      partner_name: "Partner's name",
      task_title: "Task title",
      task_description: "Task description (optional)",
      task_priority: "Priority (low, medium, high, urgent)",
      task_status: "Task status",
      task_url: "URL to task in dashboard (optional)",
    },
    template_type: "partner_task_assigned",
    is_active: true
  },
  {
    name: "Inventory Order Assigned",
    template_key: "inventory-order-assigned",
    from: "orders@jyt.com",
    subject: "Inventory order assigned: {{order_number}}",
    html_content: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
        <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <h1 style="color: #7c3aed; font-size: 24px; margin-bottom: 20px;">Inventory Order Assigned</h1>
          <p style="color: #333333; font-size: 16px; margin-bottom: 15px;">Hi {{partner_name}},</p>
          <p style="color: #666666; font-size: 16px; line-height: 1.5; margin-bottom: 20px;">
            A new inventory order has been assigned to you for processing.
          </p>
          <div style="margin: 20px 0; padding: 20px; background-color: #f5f3ff; border-radius: 6px; border-left: 4px solid #7c3aed;">
            <h3 style="color: #5b21b6; font-size: 18px; margin: 0 0 8px 0;">Order #{{order_number}}</h3>
            <p style="color: #666666; font-size: 14px; margin: 4px 0;"><strong>Status:</strong> {{order_status}}</p>
            {{#if item_count}}<p style="color: #666666; font-size: 14px; margin: 4px 0;"><strong>Items:</strong> {{item_count}} line(s)</p>{{/if}}
          </div>
          {{#if order_url}}
          <div style="margin: 30px 0; text-align: center;">
            <a href="{{order_url}}" style="background-color: #7c3aed; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">
              View Inventory Order
            </a>
          </div>
          {{/if}}
          <p style="color: #999999; font-size: 14px; margin-top: 20px;">
            Please review and accept this order from your partner dashboard.
          </p>
        </div>
      </div>
    `,
    variables: {
      partner_name: "Partner's name",
      order_number: "Inventory order number",
      order_status: "Order status",
      item_count: "Number of line items (optional)",
      order_url: "URL to order in dashboard (optional)",
    },
    template_type: "inventory_order_assigned",
    is_active: true
  },
  {
    name: "Refund Processed",
    template_key: "refund-processed",
    from: "orders@jyt.com",
    subject: "Refund processed for order #{{order_display_id}}",
    html_content: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
        <div style="background-color: #ffffff; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <h1 style="color: #333333; font-size: 24px; margin-bottom: 20px;">Refund Processed</h1>
          <p style="color: #333333; font-size: 16px; margin-bottom: 15px;">Hi {{customer_name}},</p>
          <p style="color: #666666; font-size: 16px; line-height: 1.5; margin-bottom: 20px;">
            A refund has been processed for your order <strong>#{{order_display_id}}</strong>.
          </p>
          <div style="margin: 20px 0; padding: 20px; background-color: #f0fdf4; border-radius: 6px; border: 1px solid #bbf7d0;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr><td style="padding: 6px 0; color: #666; font-size: 14px;"><strong>Refund Amount:</strong></td><td style="padding: 6px 0; font-size: 18px; font-weight: 600; color: #16a34a;">{{refund_amount}}</td></tr>
              <tr><td style="padding: 6px 0; color: #666; font-size: 14px;"><strong>Payment Method:</strong></td><td style="padding: 6px 0; font-size: 14px;">{{payment_method}}</td></tr>
              {{#if refund_reason}}<tr><td style="padding: 6px 0; color: #666; font-size: 14px;"><strong>Reason:</strong></td><td style="padding: 6px 0; font-size: 14px;">{{refund_reason}}</td></tr>{{/if}}
            </table>
          </div>
          <p style="color: #666666; font-size: 14px; line-height: 1.5; margin-top: 20px;">
            The refund should appear in your account within 5-10 business days depending on your bank or payment provider.
          </p>
          <p style="color: #999999; font-size: 14px; margin-top: 20px;">
            If you have any questions, please don't hesitate to contact us.
          </p>
        </div>
      </div>
    `,
    variables: {
      customer_name: "Customer's name",
      order_display_id: "Order display ID",
      refund_amount: "Formatted refund amount",
      payment_method: "Payment method used",
      refund_reason: "Reason for refund (optional)",
    },
    template_type: "refund_processed",
    is_active: true
  },

  // =========================================================================
  // MEDUSA-STYLED TEMPLATES — Using Medusa UI design tokens:
  //   bg-base: #FFFFFF       bg-subtle: #FAFAFA      bg-highlight: #EFF6FF
  //   fg-base: #18181B       fg-subtle: #52525B      fg-muted: #71717A
  //   fg-interactive: #3B82F6  fg-error: #E11D48     fg-on-color: #FFFFFF
  //   border-base: #E4E4E7   border-strong: #D4D4D8
  //   button-inverted: #27272A  success: #059669
  // =========================================================================

  // =========================================================================
  // ORDER LIFECYCLE EVENTS
  // =========================================================================

  {
    name: "Order Canceled",
    template_key: "order-canceled",
    from: "orders@jaalyantra.com",
    subject: "Order #{{order_display_id}} has been canceled",
    html_content: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#FAFAFA;">
<div style="max-width:640px;margin:0 auto;background:#FFFFFF;border:1px solid #E4E4E7;border-radius:12px;overflow:hidden;margin-top:24px;margin-bottom:24px;">
  <div style="background:#27272A;padding:32px;text-align:center;">
    <h1 style="color:#FFFFFF;font-size:20px;font-weight:600;margin:0;letter-spacing:-0.02em;">Jaal Yantra Textiles</h1>
  </div>
  <div style="padding:32px;">
    <p style="color:#18181B;font-size:16px;font-weight:500;margin:0;">Hi {{customer_first_name}},</p>
    <p style="color:#52525B;font-size:14px;line-height:1.6;margin:12px 0 0;">Your order <strong style="color:#18181B;">#{{order_display_id}}</strong> has been canceled.</p>
    {{#if cancel_reason}}<p style="color:#52525B;font-size:14px;margin:12px 0 0;"><strong>Reason:</strong> {{cancel_reason}}</p>{{/if}}
    <div style="margin:20px 0;padding:16px;background:#FEF2F2;border-radius:8px;border:1px solid #FECACA;">
      <p style="color:#E11D48;font-size:13px;margin:0;">If a payment was captured, a refund will be processed automatically. It may take 5–10 business days to appear.</p>
    </div>
    <p style="color:#71717A;font-size:13px;margin-top:16px;">If this was a mistake, please visit our store or contact us.</p>
  </div>
  <div style="background:#FAFAFA;padding:20px 32px;text-align:center;border-top:1px solid #E4E4E7;">
    <p style="color:#71717A;font-size:11px;margin:0;">&copy; {{current_year}} Jaal Yantra Textiles</p>
  </div>
</div></body></html>`,
    variables: {
      customer_first_name: "Customer's first name",
      order_display_id: "Order display ID",
      cancel_reason: "Cancellation reason (optional)",
      current_year: "Current year",
    },
    template_type: "order_canceled",
    is_active: true,
  },

  {
    name: "Order Completed",
    template_key: "order-completed",
    from: "orders@jaalyantra.com",
    subject: "Your order #{{order_display_id}} is complete!",
    html_content: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#FAFAFA;">
<div style="max-width:640px;margin:0 auto;background:#FFFFFF;border:1px solid #E4E4E7;border-radius:12px;overflow:hidden;margin-top:24px;margin-bottom:24px;">
  <div style="background:#27272A;padding:32px;text-align:center;">
    <h1 style="color:#FFFFFF;font-size:20px;font-weight:600;margin:0;letter-spacing:-0.02em;">Order Complete</h1>
    <p style="color:#A1A1AA;font-size:13px;margin:6px 0 0;">Thank you for shopping with us</p>
  </div>
  <div style="padding:32px;">
    <p style="color:#18181B;font-size:16px;font-weight:500;margin:0;">Hi {{customer_first_name}},</p>
    <p style="color:#52525B;font-size:14px;line-height:1.6;margin:12px 0;">Your order <strong style="color:#18181B;">#{{order_display_id}}</strong> has been completed. We hope you love your textiles!</p>
    <div style="text-align:center;margin:24px 0;">
      <a href="{{store_url}}" style="display:inline-block;background:#27272A;color:#FFFFFF;text-decoration:none;padding:10px 24px;border-radius:8px;font-weight:500;font-size:14px;">Shop Again</a>
    </div>
    <p style="color:#71717A;font-size:13px;">If you have any questions or need assistance, we're here to help.</p>
  </div>
  <div style="background:#FAFAFA;padding:20px 32px;text-align:center;border-top:1px solid #E4E4E7;">
    <p style="color:#71717A;font-size:11px;margin:0;">&copy; {{current_year}} Jaal Yantra Textiles</p>
  </div>
</div></body></html>`,
    variables: {
      customer_first_name: "Customer's first name",
      order_display_id: "Order display ID",
      store_url: "Store URL",
      current_year: "Current year",
    },
    template_type: "order_completed",
    is_active: true,
  },

  {
    name: "Return Requested",
    template_key: "order-return-requested",
    from: "orders@jaalyantra.com",
    subject: "Return request received for order #{{order_display_id}}",
    html_content: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#FAFAFA;">
<div style="max-width:640px;margin:0 auto;background:#FFFFFF;border:1px solid #E4E4E7;border-radius:12px;overflow:hidden;margin-top:24px;margin-bottom:24px;">
  <div style="background:#27272A;padding:32px;text-align:center;">
    <h1 style="color:#FFFFFF;font-size:20px;font-weight:600;margin:0;letter-spacing:-0.02em;">Jaal Yantra Textiles</h1>
  </div>
  <div style="padding:32px;">
    <p style="color:#18181B;font-size:16px;font-weight:500;margin:0;">Hi {{customer_first_name}},</p>
    <p style="color:#52525B;font-size:14px;line-height:1.6;margin:12px 0;">We've received your return request for order <strong style="color:#18181B;">#{{order_display_id}}</strong>.</p>
    <div style="margin:20px 0;padding:16px;background:#EFF6FF;border-radius:8px;border:1px solid #BFDBFE;">
      <p style="color:#3B82F6;font-size:13px;font-weight:500;margin:0 0 8px;">What happens next:</p>
      <ol style="color:#52525B;font-size:13px;line-height:1.8;margin:0;padding-left:18px;">
        <li>Our team reviews your request</li>
        <li>You'll receive return shipping instructions</li>
        <li>Refund processed after items are received</li>
      </ol>
    </div>
    {{#if return_reason}}<p style="color:#52525B;font-size:13px;"><strong>Reason:</strong> {{return_reason}}</p>{{/if}}
  </div>
  <div style="background:#FAFAFA;padding:20px 32px;text-align:center;border-top:1px solid #E4E4E7;">
    <p style="color:#71717A;font-size:11px;margin:0;">&copy; {{current_year}} Jaal Yantra Textiles</p>
  </div>
</div></body></html>`,
    variables: { customer_first_name: "Customer's first name", order_display_id: "Order display ID", return_reason: "Return reason (optional)", current_year: "Current year" },
    template_type: "return_requested",
    is_active: true,
  },

  {
    name: "Return Received",
    template_key: "order-return-received",
    from: "orders@jaalyantra.com",
    subject: "Return received for order #{{order_display_id}}",
    html_content: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#FAFAFA;">
<div style="max-width:640px;margin:0 auto;background:#FFFFFF;border:1px solid #E4E4E7;border-radius:12px;overflow:hidden;margin-top:24px;margin-bottom:24px;">
  <div style="background:#27272A;padding:32px;text-align:center;">
    <h1 style="color:#FFFFFF;font-size:20px;font-weight:600;margin:0;">Return Received</h1>
  </div>
  <div style="padding:32px;">
    <p style="color:#18181B;font-size:16px;font-weight:500;margin:0;">Hi {{customer_first_name}},</p>
    <p style="color:#52525B;font-size:14px;line-height:1.6;margin:12px 0;">We've received your returned items for order <strong style="color:#18181B;">#{{order_display_id}}</strong>. Your refund is being processed.</p>
    <div style="margin:20px 0;padding:16px;background:#F0FDF4;border-radius:8px;border:1px solid #BBF7D0;">
      <p style="color:#059669;font-size:13px;margin:0;">Refund should appear in your account within 5–10 business days.</p>
    </div>
  </div>
  <div style="background:#FAFAFA;padding:20px 32px;text-align:center;border-top:1px solid #E4E4E7;">
    <p style="color:#71717A;font-size:11px;margin:0;">&copy; {{current_year}} Jaal Yantra Textiles</p>
  </div>
</div></body></html>`,
    variables: { customer_first_name: "Customer's first name", order_display_id: "Order display ID", current_year: "Current year" },
    template_type: "return_received",
    is_active: true,
  },

  {
    name: "Claim Created",
    template_key: "order-claim-created",
    from: "orders@jaalyantra.com",
    subject: "Claim created for order #{{order_display_id}}",
    html_content: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#FAFAFA;">
<div style="max-width:640px;margin:0 auto;background:#FFFFFF;border:1px solid #E4E4E7;border-radius:12px;overflow:hidden;margin-top:24px;margin-bottom:24px;">
  <div style="background:#27272A;padding:32px;text-align:center;">
    <h1 style="color:#FFFFFF;font-size:20px;font-weight:600;margin:0;">Jaal Yantra Textiles</h1>
  </div>
  <div style="padding:32px;">
    <p style="color:#18181B;font-size:16px;font-weight:500;margin:0;">Hi {{customer_first_name}},</p>
    <p style="color:#52525B;font-size:14px;line-height:1.6;margin:12px 0;">A claim has been created for your order <strong style="color:#18181B;">#{{order_display_id}}</strong>. Our team is reviewing it and will follow up shortly.</p>
    {{#if claim_reason}}<p style="color:#52525B;font-size:13px;margin:12px 0;"><strong>Reason:</strong> {{claim_reason}}</p>{{/if}}
    <p style="color:#71717A;font-size:13px;margin-top:16px;">We take quality seriously and will resolve this quickly.</p>
  </div>
  <div style="background:#FAFAFA;padding:20px 32px;text-align:center;border-top:1px solid #E4E4E7;">
    <p style="color:#71717A;font-size:11px;margin:0;">&copy; {{current_year}} Jaal Yantra Textiles</p>
  </div>
</div></body></html>`,
    variables: { customer_first_name: "Customer's first name", order_display_id: "Order display ID", claim_reason: "Claim reason (optional)", current_year: "Current year" },
    template_type: "claim_created",
    is_active: true,
  },

  {
    name: "Exchange Created",
    template_key: "order-exchange-created",
    from: "orders@jaalyantra.com",
    subject: "Exchange initiated for order #{{order_display_id}}",
    html_content: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#FAFAFA;">
<div style="max-width:640px;margin:0 auto;background:#FFFFFF;border:1px solid #E4E4E7;border-radius:12px;overflow:hidden;margin-top:24px;margin-bottom:24px;">
  <div style="background:#27272A;padding:32px;text-align:center;">
    <h1 style="color:#FFFFFF;font-size:20px;font-weight:600;margin:0;">Exchange Initiated</h1>
  </div>
  <div style="padding:32px;">
    <p style="color:#18181B;font-size:16px;font-weight:500;margin:0;">Hi {{customer_first_name}},</p>
    <p style="color:#52525B;font-size:14px;line-height:1.6;margin:12px 0;">An exchange has been initiated for order <strong style="color:#18181B;">#{{order_display_id}}</strong>.</p>
    <div style="margin:20px 0;padding:16px;background:#EFF6FF;border-radius:8px;border:1px solid #BFDBFE;">
      <p style="color:#3B82F6;font-size:13px;margin:0;">We'll send return shipping instructions. Once we receive the originals, the replacement ships to you.</p>
    </div>
  </div>
  <div style="background:#FAFAFA;padding:20px 32px;text-align:center;border-top:1px solid #E4E4E7;">
    <p style="color:#71717A;font-size:11px;margin:0;">&copy; {{current_year}} Jaal Yantra Textiles</p>
  </div>
</div></body></html>`,
    variables: { customer_first_name: "Customer's first name", order_display_id: "Order display ID", current_year: "Current year" },
    template_type: "exchange_created",
    is_active: true,
  },

  {
    name: "Order Transfer Requested",
    template_key: "order-transfer-requested",
    from: "orders@jaalyantra.com",
    subject: "Order #{{order_display_id}} transfer request",
    html_content: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#FAFAFA;">
<div style="max-width:640px;margin:0 auto;background:#FFFFFF;border:1px solid #E4E4E7;border-radius:12px;overflow:hidden;margin-top:24px;margin-bottom:24px;">
  <div style="background:#27272A;padding:32px;text-align:center;">
    <h1 style="color:#FFFFFF;font-size:20px;font-weight:600;margin:0;">Jaal Yantra Textiles</h1>
  </div>
  <div style="padding:32px;">
    <p style="color:#18181B;font-size:16px;font-weight:500;margin:0;">Hi {{customer_first_name}},</p>
    <p style="color:#52525B;font-size:14px;line-height:1.6;margin:12px 0;">A transfer has been requested for order <strong style="color:#18181B;">#{{order_display_id}}</strong> to <strong>{{new_customer_email}}</strong>.</p>
    <div style="margin:20px 0;padding:16px;background:#FEF2F2;border-radius:8px;border:1px solid #FECACA;">
      <p style="color:#E11D48;font-size:13px;margin:0;">If you did not request this, contact support immediately.</p>
    </div>
  </div>
  <div style="background:#FAFAFA;padding:20px 32px;text-align:center;border-top:1px solid #E4E4E7;">
    <p style="color:#71717A;font-size:11px;margin:0;">&copy; {{current_year}} Jaal Yantra Textiles</p>
  </div>
</div></body></html>`,
    variables: { customer_first_name: "Customer's first name", order_display_id: "Order display ID", new_customer_email: "New customer email", current_year: "Current year" },
    template_type: "order_transfer_requested",
    is_active: true,
  },

  {
    name: "Fulfillment Created",
    template_key: "order-fulfillment-created",
    from: "orders@jaalyantra.com",
    subject: "Your order #{{order_display_id}} is being prepared",
    html_content: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#FAFAFA;">
<div style="max-width:640px;margin:0 auto;background:#FFFFFF;border:1px solid #E4E4E7;border-radius:12px;overflow:hidden;margin-top:24px;margin-bottom:24px;">
  <div style="background:#27272A;padding:32px;text-align:center;">
    <h1 style="color:#FFFFFF;font-size:20px;font-weight:600;margin:0;">Order Being Prepared</h1>
    <p style="color:#A1A1AA;font-size:13px;margin:6px 0 0;">Your textiles are being packed with care</p>
  </div>
  <div style="padding:32px;">
    <p style="color:#18181B;font-size:16px;font-weight:500;margin:0;">Hi {{customer_first_name}},</p>
    <p style="color:#52525B;font-size:14px;line-height:1.6;margin:12px 0;">We've started preparing your order <strong style="color:#18181B;">#{{order_display_id}}</strong> for shipment.</p>
    <p style="color:#71717A;font-size:13px;">You'll receive tracking details once your package is on its way.</p>
  </div>
  <div style="background:#FAFAFA;padding:20px 32px;text-align:center;border-top:1px solid #E4E4E7;">
    <p style="color:#71717A;font-size:11px;margin:0;">&copy; {{current_year}} Jaal Yantra Textiles</p>
  </div>
</div></body></html>`,
    variables: { customer_first_name: "Customer's first name", order_display_id: "Order display ID", current_year: "Current year" },
    template_type: "fulfillment_created",
    is_active: true,
  },

  // =========================================================================
  // PAYMENT EVENTS
  // =========================================================================

  {
    name: "Payment Captured",
    template_key: "payment-captured",
    from: "orders@jaalyantra.com",
    subject: "Payment received for order #{{order_display_id}}",
    html_content: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#FAFAFA;">
<div style="max-width:640px;margin:0 auto;background:#FFFFFF;border:1px solid #E4E4E7;border-radius:12px;overflow:hidden;margin-top:24px;margin-bottom:24px;">
  <div style="background:#27272A;padding:32px;text-align:center;">
    <h1 style="color:#FFFFFF;font-size:20px;font-weight:600;margin:0;">Payment Confirmed</h1>
  </div>
  <div style="padding:32px;">
    <p style="color:#18181B;font-size:16px;font-weight:500;margin:0;">Hi {{customer_first_name}},</p>
    <p style="color:#52525B;font-size:14px;line-height:1.6;margin:12px 0;">Payment received for order <strong style="color:#18181B;">#{{order_display_id}}</strong>.</p>
    <div style="margin:20px 0;padding:16px;background:#F0FDF4;border-radius:8px;border:1px solid #BBF7D0;">
      <table style="width:100%;border-collapse:collapse;">
        <tr><td style="padding:4px 0;color:#52525B;font-size:13px;"><strong>Amount:</strong></td><td style="padding:4px 0;font-size:16px;font-weight:600;color:#059669;">{{payment_amount}}</td></tr>
        {{#if payment_method}}<tr><td style="padding:4px 0;color:#52525B;font-size:13px;"><strong>Method:</strong></td><td style="padding:4px 0;font-size:13px;color:#52525B;">{{payment_method}}</td></tr>{{/if}}
      </table>
    </div>
    <p style="color:#71717A;font-size:13px;">Your order is now being processed.</p>
  </div>
  <div style="background:#FAFAFA;padding:20px 32px;text-align:center;border-top:1px solid #E4E4E7;">
    <p style="color:#71717A;font-size:11px;margin:0;">&copy; {{current_year}} Jaal Yantra Textiles</p>
  </div>
</div></body></html>`,
    variables: { customer_first_name: "Customer's first name", order_display_id: "Order display ID", payment_amount: "Formatted payment amount", payment_method: "Payment method (optional)", current_year: "Current year" },
    template_type: "payment_captured",
    is_active: true,
  },

  // =========================================================================
  // INVITE & USER EVENTS
  // =========================================================================

  {
    name: "Admin Invite",
    template_key: "invite-created",
    from: "admin@jaalyantra.com",
    subject: "You're invited to join Jaal Yantra Textiles",
    html_content: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#FAFAFA;">
<div style="max-width:640px;margin:0 auto;background:#FFFFFF;border:1px solid #E4E4E7;border-radius:12px;overflow:hidden;margin-top:24px;margin-bottom:24px;">
  <div style="background:#27272A;padding:32px;text-align:center;">
    <h1 style="color:#FFFFFF;font-size:20px;font-weight:600;margin:0;">You're Invited</h1>
    <p style="color:#A1A1AA;font-size:13px;margin:6px 0 0;">Join the Jaal Yantra Textiles team</p>
  </div>
  <div style="padding:32px;">
    <p style="color:#52525B;font-size:14px;line-height:1.6;margin:0 0 16px;">You've been invited to join the Jaal Yantra Textiles admin panel. Click below to accept and set up your account.</p>
    <div style="text-align:center;margin:24px 0;">
      <a href="{{invite_url}}" style="display:inline-block;background:#27272A;color:#FFFFFF;text-decoration:none;padding:10px 24px;border-radius:8px;font-weight:500;font-size:14px;">Accept Invitation</a>
    </div>
    <p style="color:#A1A1AA;font-size:12px;margin-top:16px;">This invitation expires in 7 days. If unexpected, ignore this email.</p>
  </div>
  <div style="background:#FAFAFA;padding:20px 32px;text-align:center;border-top:1px solid #E4E4E7;">
    <p style="color:#71717A;font-size:11px;margin:0;">&copy; {{current_year}} Jaal Yantra Textiles</p>
  </div>
</div></body></html>`,
    variables: { invite_url: "Invitation acceptance URL", current_year: "Current year" },
    template_type: "invite_created",
    is_active: true,
  },

  // =========================================================================
  // ORDER EDIT EVENTS
  // =========================================================================

  {
    name: "Order Edit Requested",
    template_key: "order-edit-requested",
    from: "orders@jaalyantra.com",
    subject: "Edit requested for order #{{order_display_id}}",
    html_content: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#FAFAFA;">
<div style="max-width:640px;margin:0 auto;background:#FFFFFF;border:1px solid #E4E4E7;border-radius:12px;overflow:hidden;margin-top:24px;margin-bottom:24px;">
  <div style="background:#27272A;padding:32px;text-align:center;">
    <h1 style="color:#FFFFFF;font-size:20px;font-weight:600;margin:0;">Jaal Yantra Textiles</h1>
  </div>
  <div style="padding:32px;">
    <p style="color:#18181B;font-size:16px;font-weight:500;margin:0;">Hi {{customer_first_name}},</p>
    <p style="color:#52525B;font-size:14px;line-height:1.6;margin:12px 0;">An edit has been requested for order <strong style="color:#18181B;">#{{order_display_id}}</strong>. Please review and confirm or decline.</p>
    {{#if edit_description}}<div style="margin:16px 0;padding:12px 16px;background:#FFFBEB;border-radius:8px;border:1px solid #FDE68A;"><p style="color:#92400E;font-size:13px;margin:0;"><strong>Changes:</strong> {{edit_description}}</p></div>{{/if}}
    <div style="text-align:center;margin:24px 0;">
      <a href="{{confirm_url}}" style="display:inline-block;background:#27272A;color:#FFFFFF;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:500;font-size:14px;margin-right:8px;">Confirm</a>
      <a href="{{decline_url}}" style="display:inline-block;background:#FFFFFF;color:#E11D48;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:500;font-size:14px;border:1px solid #E4E4E7;">Decline</a>
    </div>
  </div>
  <div style="background:#FAFAFA;padding:20px 32px;text-align:center;border-top:1px solid #E4E4E7;">
    <p style="color:#71717A;font-size:11px;margin:0;">&copy; {{current_year}} Jaal Yantra Textiles</p>
  </div>
</div></body></html>`,
    variables: { customer_first_name: "Customer's first name", order_display_id: "Order display ID", edit_description: "Description of changes (optional)", confirm_url: "URL to confirm the edit", decline_url: "URL to decline the edit", current_year: "Current year" },
    template_type: "order_edit_requested",
    is_active: true,
  },

  {
    name: "Order Edit Confirmed",
    template_key: "order-edit-confirmed",
    from: "orders@jaalyantra.com",
    subject: "Order edit confirmed for #{{order_display_id}}",
    html_content: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#FAFAFA;">
<div style="max-width:640px;margin:0 auto;background:#FFFFFF;border:1px solid #E4E4E7;border-radius:12px;overflow:hidden;margin-top:24px;margin-bottom:24px;">
  <div style="background:#27272A;padding:32px;text-align:center;">
    <h1 style="color:#FFFFFF;font-size:20px;font-weight:600;margin:0;">Edit Confirmed</h1>
  </div>
  <div style="padding:32px;">
    <p style="color:#18181B;font-size:16px;font-weight:500;margin:0;">Hi {{customer_first_name}},</p>
    <p style="color:#52525B;font-size:14px;line-height:1.6;margin:12px 0;">The edit to order <strong style="color:#18181B;">#{{order_display_id}}</strong> has been confirmed and applied.</p>
    {{#if difference_due}}<div style="margin:16px 0;padding:12px 16px;background:#EFF6FF;border-radius:8px;border:1px solid #BFDBFE;"><p style="color:#3B82F6;font-size:13px;margin:0;"><strong>Additional amount:</strong> {{difference_due}}</p></div>{{/if}}
    <p style="color:#71717A;font-size:13px;margin-top:16px;">Your updated order is now being processed.</p>
  </div>
  <div style="background:#FAFAFA;padding:20px 32px;text-align:center;border-top:1px solid #E4E4E7;">
    <p style="color:#71717A;font-size:11px;margin:0;">&copy; {{current_year}} Jaal Yantra Textiles</p>
  </div>
</div></body></html>`,
    variables: { customer_first_name: "Customer's first name", order_display_id: "Order display ID", difference_due: "Additional amount due (optional)", current_year: "Current year" },
    template_type: "order_edit_confirmed",
    is_active: true,
  },

  // =========================================================================
  // DELIVERY & PARTNER EVENTS
  // =========================================================================

  {
    name: "Delivery Confirmed",
    template_key: "delivery-created",
    from: "orders@jaalyantra.com",
    subject: "Your order #{{order_display_id}} has been delivered",
    html_content: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#FAFAFA;">
<div style="max-width:640px;margin:0 auto;background:#FFFFFF;border:1px solid #E4E4E7;border-radius:12px;overflow:hidden;margin-top:24px;margin-bottom:24px;">
  <div style="background:#27272A;padding:32px;text-align:center;">
    <h1 style="color:#FFFFFF;font-size:20px;font-weight:600;margin:0;">Delivered</h1>
    <p style="color:#A1A1AA;font-size:13px;margin:6px 0 0;">Your textiles have arrived</p>
  </div>
  <div style="padding:32px;">
    <p style="color:#18181B;font-size:16px;font-weight:500;margin:0;">Hi {{customer_first_name}},</p>
    <p style="color:#52525B;font-size:14px;line-height:1.6;margin:12px 0;">Your order <strong style="color:#18181B;">#{{order_display_id}}</strong> has been delivered. We hope you love your new textiles!</p>
    <div style="text-align:center;margin:24px 0;">
      <a href="{{store_url}}" style="display:inline-block;background:#27272A;color:#FFFFFF;text-decoration:none;padding:10px 24px;border-radius:8px;font-weight:500;font-size:14px;">Shop More</a>
    </div>
    <p style="color:#71717A;font-size:13px;">Not happy? Contact us within 7 days for a return or exchange.</p>
  </div>
  <div style="background:#FAFAFA;padding:20px 32px;text-align:center;border-top:1px solid #E4E4E7;">
    <p style="color:#71717A;font-size:11px;margin:0;">&copy; {{current_year}} Jaal Yantra Textiles</p>
  </div>
</div></body></html>`,
    variables: { customer_first_name: "Customer's first name", order_display_id: "Order display ID", store_url: "Store URL", current_year: "Current year" },
    template_type: "delivery_created",
    is_active: true,
  },

  {
    name: "Partner Admin Added",
    template_key: "partner-admin-added",
    from: "partners@jaalyantra.com",
    subject: "You've been added as an admin for {{partner_name}}",
    html_content: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#FAFAFA;">
<div style="max-width:640px;margin:0 auto;background:#FFFFFF;border:1px solid #E4E4E7;border-radius:12px;overflow:hidden;margin-top:24px;margin-bottom:24px;">
  <div style="background:#27272A;padding:32px;text-align:center;">
    <h1 style="color:#FFFFFF;font-size:20px;font-weight:600;margin:0;">Jaal Yantra Textiles</h1>
    <p style="color:#A1A1AA;font-size:13px;margin:6px 0 0;">Partner Portal</p>
  </div>
  <div style="padding:32px;">
    <p style="color:#18181B;font-size:16px;font-weight:500;margin:0;">Hi {{admin_name}},</p>
    <p style="color:#52525B;font-size:14px;line-height:1.6;margin:12px 0;">You've been added as an administrator for <strong style="color:#18181B;">{{partner_name}}</strong>.</p>
    <div style="text-align:center;margin:24px 0;">
      <a href="{{login_url}}" style="display:inline-block;background:#27272A;color:#FFFFFF;text-decoration:none;padding:10px 24px;border-radius:8px;font-weight:500;font-size:14px;">Access Partner Portal</a>
    </div>
    <p style="color:#71717A;font-size:13px;">You can now manage orders, products, and settings for {{partner_name}}.</p>
  </div>
  <div style="background:#FAFAFA;padding:20px 32px;text-align:center;border-top:1px solid #E4E4E7;">
    <p style="color:#71717A;font-size:11px;margin:0;">&copy; {{current_year}} Jaal Yantra Textiles</p>
  </div>
</div></body></html>`,
    variables: { admin_name: "New admin's name", partner_name: "Partner organization name", login_url: "Partner portal login URL", current_year: "Current year" },
    template_type: "partner_admin_added",
    is_active: true,
  },

  // =========================================================================
  // CART EVENTS
  // =========================================================================

  {
    name: "Abandoned Cart Reminder",
    template_key: "cart-abandoned",
    from: "shop@jaalyantra.com",
    subject: "You left something beautiful behind",
    html_content: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#FAFAFA;">
<div style="max-width:640px;margin:0 auto;background:#FFFFFF;border:1px solid #E4E4E7;border-radius:12px;overflow:hidden;margin-top:24px;margin-bottom:24px;">
  <div style="background:#27272A;padding:32px;text-align:center;">
    <h1 style="color:#FFFFFF;font-size:20px;font-weight:600;margin:0;">Your cart is waiting</h1>
    <p style="color:#A1A1AA;font-size:13px;margin:6px 0 0;">You left some beautiful textiles behind</p>
  </div>
  <div style="padding:32px;">
    <p style="color:#18181B;font-size:16px;font-weight:500;margin:0;">Hi {{customer_first_name}},</p>
    <p style="color:#52525B;font-size:14px;line-height:1.6;margin:12px 0;">We noticed you left some items in your cart. They're still available — but they might not be for long.</p>
    <div style="text-align:center;margin:24px 0;">
      <a href="{{cart_url}}" style="display:inline-block;background:#27272A;color:#FFFFFF;text-decoration:none;padding:10px 24px;border-radius:8px;font-weight:500;font-size:14px;">Complete Your Order</a>
    </div>
    <p style="color:#71717A;font-size:13px;">Need help choosing? Our team is always here.</p>
  </div>
  <div style="background:#FAFAFA;padding:20px 32px;text-align:center;border-top:1px solid #E4E4E7;">
    <p style="color:#71717A;font-size:11px;margin:0;">&copy; {{current_year}} Jaal Yantra Textiles</p>
    <p style="color:#A1A1AA;font-size:10px;margin:4px 0 0;"><a href="{{unsubscribe_url}}" style="color:#A1A1AA;">Unsubscribe</a></p>
  </div>
</div></body></html>`,
    variables: { customer_first_name: "Customer's first name", cart_url: "Cart recovery URL", unsubscribe_url: "Unsubscribe URL", current_year: "Current year" },
    template_type: "cart_abandoned",
    is_active: true,
  },
]

export default async function seedEmailTemplates({ container }: { container: any }) {
  const emailTemplatesService = container.resolve(EMAIL_TEMPLATES_MODULE)
  
  console.log("Seeding email templates...")
  
  for (const templateData of emailTemplatesData) {
    let existingTemplate: any = null

    try {
      existingTemplate = await emailTemplatesService.getTemplateByKey(templateData.template_key)
    } catch (error: any) {
      const isMissingTemplate =
        error instanceof MedusaError && error.type === MedusaError.Types.NOT_FOUND

      if (!isMissingTemplate) {
        console.error(`Failed to inspect template '${templateData.template_key}':`, error.message)
        continue
      }
    }

    if (existingTemplate) {
      console.log(`Template '${templateData.template_key}' already exists, skipping...`)
      continue
    }

    try {
      await emailTemplatesService.createEmailTemplates(templateData)
      console.log(`Created email template: ${templateData.name}`)
    } catch (error: any) {
      console.error(`Failed to create template '${templateData.name}':`, error.message)
    }
  }
  
  console.log("Email templates seeding completed!")
}
