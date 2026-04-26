import { Button, Heading, Text } from "@medusajs/ui"
import { useParams } from "react-router-dom"
import { useInitiateSocialPlatformOAuth } from "../../hooks/api/social-platforms";
import { useSocialPlatform } from "../../hooks/api/social-platforms";
import { RouteFocusModal } from "../modal/route-focus-modal";

const InstagramIcon = (props: any) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    className="h-16 w-16"
    {...props}
  >
    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.85s-.011 3.584-.069 4.85c-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07s-3.584-.012-4.85-.07c-3.252-.148-4.771-1.691-4.919-4.919-.058-1.265-.069-1.645-.069-4.85s.011-3.584.069-4.85c.149-3.225 1.664-4.771 4.919-4.919C8.416 2.175 8.796 2.163 12 2.163zm0 1.441c-3.116 0-3.478.011-4.694.067-2.445.111-3.691 1.357-3.806 3.806-.056 1.217-.066 1.578-.066 4.694s.01 3.477.066 4.694c.115 2.449 1.361 3.695 3.806 3.806 1.217.056 1.578.066 4.694.066s3.477-.01 4.694-.066c2.445-.111 3.691-1.357 3.806-3.806.056-1.217.066-1.578.066-4.694s-.01-3.477-.066-4.694c-.115-2.449-1.361-3.695-3.806-3.806C15.478 3.615 15.116 3.604 12 3.604zm0 4.232c-2.417 0-4.375 1.958-4.375 4.375s1.958 4.375 4.375 4.375 4.375-1.958 4.375-4.375-1.958-4.375-4.375-4.375zm0 7.168c-1.537 0-2.793-1.256-2.793-2.793s1.256-2.793 2.793-2.793 2.793 1.256 2.793 2.793-1.256 2.793-2.793 2.793zm4.838-7.822c-.604 0-1.093.489-1.093 1.093s.489 1.093 1.093 1.093 1.093-.489 1.093-1.093-.489-1.093-1.093-1.093z" />
  </svg>
);

const FacebookIcon = (props: any) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-16 w-16" {...props}>
    <path d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.878v-6.987h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.988C18.343 21.128 22 16.991 22 12z"/>
  </svg>
);

const LinkedInIcon = (props: any) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-16 w-16" {...props}>
      <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/>
  </svg>
);

const TwitterIcon = (props: any) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    className="h-16 w-16"
    {...props}
  >
    <path d="M22.162 0H1.838C.82 0 0 .82 0 1.838v20.324C0 23.18.82 24 1.838 24h20.324C23.18 24 24 23.18 24 22.162V1.838C24 .82 23.18 0 22.162 0zM18.857 17.086h-2.15l-3.578-4.893-3.42 4.893H7.334l4.314-6.116L7.598 6.914h2.15l3.249 4.441 3.112-4.441h2.15l-4.2 5.9 4.098 6.272z" />
  </svg>
);

const FBINSTAIcon = (props: any) => (
  <div className="flex items-center gap-2" {...props}>
    <FacebookIcon className="h-12 w-12" />
    <span className="text-2xl font-bold text-ui-fg-muted">+</span>
    <InstagramIcon className="h-12 w-12" />
  </div>
);

const SocialIcon = ({ platformName }: { platformName: string }) => {
  const name = platformName.toLowerCase();
  switch (name) {
    case 'instagram':
      return <InstagramIcon />;
    case 'facebook':
      return <FacebookIcon />;
    case 'fbinsta':
    case 'facebook & instagram':
      return <FBINSTAIcon />;
    case 'linkedin':
      return <LinkedInIcon />;
    case 'twitter':
      return <TwitterIcon />;
    default:
      return <div />;
  }
};

export const SocialPlatformAccessComponent = () => {
  const { id } = useParams<{ id: string }>();
  const platformId = id!;
  const { socialPlatform, isLoading } = useSocialPlatform(id!);
    const { mutate: initiateOAuth } = useInitiateSocialPlatformOAuth();

  const handleLogin = () => {
    if (!socialPlatform) return;
    // Treat FBINSTA as Facebook for OAuth
    const platformName = socialPlatform.name.toLowerCase();
    const oauthPlatform = (platformName === 'fbinsta' || platformName === 'facebook & instagram') 
      ? 'facebook' 
      : platformName;
    initiateOAuth({ platform: oauthPlatform, id: platformId });
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center p-16">Loading...</div>
    );
  }

  if (!socialPlatform) {
    return (
      <RouteFocusModal>
        <RouteFocusModal.Header>
          <RouteFocusModal.Close asChild>
            <Button size="small" variant="secondary">
              Close
            </Button>
          </RouteFocusModal.Close>
        </RouteFocusModal.Header>
        <RouteFocusModal.Body>
          <div className="flex flex-col items-center p-16">
            <Heading level="h2" className="text-center">Error</Heading>
            <Text className="text-center mt-2">Could not load social platform details.</Text>
          </div>
        </RouteFocusModal.Body>
      </RouteFocusModal>
    );
  }

  return (
    <RouteFocusModal>
      <RouteFocusModal.Header>
        <div className="flex items-center justify-end w-full">
          <RouteFocusModal.Close asChild>
            <Button size="small" variant="secondary">
              Close
            </Button>
          </RouteFocusModal.Close>
        </div>
      </RouteFocusModal.Header>
      <RouteFocusModal.Body className="flex flex-col items-center overflow-y-auto p-16">
        <div className="flex w-full max-w-[720px] flex-col items-center gap-y-8">
          <div className="text-center">
            <Heading>Connect to {socialPlatform.name}</Heading>
            <Text size="small" className="text-ui-fg-subtle mt-2">
              You will be redirected to {socialPlatform.name} to authorize the connection.
            </Text>
          </div>
          
          <div className="flex flex-col items-center gap-y-4">
            <SocialIcon platformName={socialPlatform.name} />
            <Button
               size="small"
               variant="primary"
               onClick={handleLogin}
             >
               Log in with {socialPlatform.name}
             </Button>

             {(socialPlatform.name.toLowerCase() === "twitter" || socialPlatform.name.toLowerCase() === "x") && (
               <Button
                 size="small"
                 variant="secondary"
                 onClick={() => initiateOAuth({ platform: socialPlatform.name.toLowerCase(), id: platformId, flow: "app-only" })}
               >
                 App-only access
               </Button>
             )}
          </div>
        </div>
      </RouteFocusModal.Body>
    </RouteFocusModal>
  );
};
