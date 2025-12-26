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
    name: "Shipment Created",
    template_key: "order-shipment-created",
    from: "orders@jyt.com",
    subject: "Your order {{order_id}} just shipped 🚚",
    html_content: `
      <div class="bg-slate-100 py-10">
        <table class="w-full max-w-2xl mx-auto bg-white shadow-xl rounded-2xl overflow-hidden font-['Inter',sans-serif]">
          <thead>
            <tr class="bg-gradient-to-r from-slate-900 to-indigo-900">
              <th class="p-8 text-left">
                <p class="text-sm uppercase tracking-[0.3em] text-indigo-200">Jaal Yantra Textiles</p>
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
      <div class="bg-emerald-50 py-10">
        <div class="max-w-2xl mx-auto bg-white rounded-3xl shadow-2xl overflow-hidden font-['Inter',sans-serif]">
          <div class="bg-emerald-600 p-10 text-white">
            <p class="uppercase tracking-[0.35em] text-emerald-200 text-xs">Delivery confirmation</p>
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
