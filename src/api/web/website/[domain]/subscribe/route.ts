import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { findWebsiteByDomainWorkflow } from "../../../../../workflows/website/find-website-by-domain";
import { z } from "zod";
import createPersonWorkflow from "../../../../../workflows/create-person";
import { SubscriptionSchema } from "../validators";
import createPersonTagsWorkflow from "../../../../../workflows/persons/create-person-tags";

export const POST = async (
  req: MedusaRequest<SubscriptionSchema>,
  res: MedusaResponse,
) => {
  const { domain } = req.params;
  
    const { email, first_name, last_name } = req.validatedBody;
    
    // First, find the website to ensure it exists and get its details
    const websiteResponse = await findWebsiteByDomainWorkflow(req.scope).run({
      input: {
        domain,
      },
    });
    
    if (websiteResponse.errors.length > 0) {
      throw websiteResponse.errors;
    }
    
    const website = websiteResponse.result;
    
    // Create a person with subscription metadata
    const {result, errors} = await createPersonWorkflow(req.scope).run({
      input: {
        first_name,
        last_name,
        email,
        metadata: {
          is_subscriber: true,
          subscribed_to_website: website.name,
          subscribed_to_domain: domain,
          subscription_date: new Date().toISOString(),
          subscription_source: "website",
        },
      },
    });
    
    if (errors.length > 0) {
      throw errors;
    }
    
    const person = result;
    
    // Add the "Subscriber" tag to the person

    await createPersonTagsWorkflow(req.scope).run({
      input: {
        name: {
            type: "Subscriber",
            from: "website"
        },
        person_id: person.id
      },
    });
   
    // Check for duplicate email
    if (typeof errors === 'object' && errors !== null && 'message' in errors && 
        typeof errors.message === 'string' && 
        (errors.message.includes("duplicate key") || errors.message.includes("already exists"))) {
      return res.status(409).json({
        message: "This email is already subscribed",
      });
    }
    
    return res.status(200).json({
      message: "Subscription successful",
    });
  }
