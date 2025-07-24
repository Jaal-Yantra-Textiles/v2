import { EMAIL_TEMPLATES_MODULE } from "../modules/email_templates";

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
                © {{current_year}} Jaal Yantra Textiles. All rights reserved.
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
  }
]

export default async function seedEmailTemplates({ container }: { container: any }) {
  const emailTemplatesService = container.resolve(EMAIL_TEMPLATES_MODULE)
  
  console.log("Seeding email templates...")
  
  for (const templateData of emailTemplatesData) {
    try {
      // Check if template already exists
      const existingTemplate = await emailTemplatesService.getTemplateByKey(templateData.template_key)
      
      if (existingTemplate) {
        console.log(`Template '${templateData.template_key}' already exists, skipping...`)
        continue
      }
      
      // Create the template
      await emailTemplatesService.createEmailTemplates(templateData)
      console.log(`Created email template: ${templateData.name}`)
    } catch (error) {
      console.error(`Failed to create template '${templateData.name}':`, error.message)
    }
  }
  
  console.log("Email templates seeding completed!")
}
