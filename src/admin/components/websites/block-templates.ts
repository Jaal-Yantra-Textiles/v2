export type BlockType = 'Hero' | 'Header' | 'Footer' | 'Feature' | 'Gallery' | 'Testimonial' | 'MainContent';

export interface BlockContent {
  [key: string]: any;
}

export interface BlockSettings {
  backgroundColor?: string;
  textColor?: string;
  padding?: string;
  alignment?: 'left' | 'center' | 'right';
  [key: string]: any;
}

export const blockTemplates = {
  Hero: {
    name: "Hero Section",
    type: "Hero" as BlockType,
    content: {
      title: "Welcome to Our Platform",
      subtitle: "Discover amazing features and possibilities",
      layout: "full",
      buttons: [
        {
          text: "Get Started",
          variant: "primary",
          link: "#"
        }
      ],
      stats: [
        { label: "Active Users", value: "2M+" },
        { label: "Downloads", value: "10K+" },
        { label: "5 Star Reviews", value: "500+" }
      ]
    },
    settings: {
      backgroundColor: "#ffffff",
      textColor: "#000000",
      padding: "8rem",
      alignment: "left"
    }
  },
  Header: {
    name: "Header Section",
    type: "Header" as BlockType,
    content: {
      logo: "/logo.png",
      navigation: [
        { text: "Home", link: "/" },
        { text: "About", link: "/about" },
        { text: "Contact", link: "/contact" }
      ],
      cta: {
        text: "Sign Up",
        link: "/signup"
      }
    },
    settings: {
      backgroundColor: "#ffffff",
      textColor: "#000000",
      padding: "1rem",
      sticky: true
    }
  },
  Feature: {
    name: "Feature Section",
    type: "Feature" as BlockType,
    content: {
      title: "Key Features",
      features: [
        {
          title: "Easy to Use",
          description: "Intuitive interface for seamless experience",
          icon: "sparkles"
        },
        {
          title: "Customizable",
          description: "Adapt to your needs with flexible options",
          icon: "adjustments"
        },
        {
          title: "Scalable",
          description: "Grows with your business needs",
          icon: "chart-bar"
        }
      ]
    },
    settings: {
      backgroundColor: "#f8fafc",
      textColor: "#000000",
      padding: "4rem",
      columns: 3
    }
  },
  Gallery: {
    name: "Gallery Section",
    type: "Gallery" as BlockType,
    content: {
      title: "Our Work",
      description: "Browse through our latest projects",
      images: [
        {
          src: "/placeholder-1.jpg",
          alt: "Project 1",
          caption: "Project 1 Description"
        },
        {
          src: "/placeholder-2.jpg",
          alt: "Project 2",
          caption: "Project 2 Description"
        }
      ]
    },
    settings: {
      backgroundColor: "#ffffff",
      padding: "4rem",
      layout: "grid",
      columns: 3
    }
  },
  Testimonial: {
    name: "Testimonial Section",
    type: "Testimonial" as BlockType,
    content: {
      title: "What Our Customers Say",
      testimonials: [
        {
          quote: "Amazing service and support!",
          author: "John Doe",
          role: "CEO, Company Inc",
          avatar: "/avatar-1.jpg"
        },
        {
          quote: "Best platform we've used!",
          author: "Jane Smith",
          role: "CTO, Tech Corp",
          avatar: "/avatar-2.jpg"
        }
      ]
    },
    settings: {
      backgroundColor: "#f8fafc",
      textColor: "#000000",
      padding: "4rem",
      style: "cards"
    }
  },
  Footer: {
    name: "Footer Section",
    type: "Footer" as BlockType,
    content: {
      logo: "/logo.png",
      columns: [
        {
          title: "Company",
          links: [
            { text: "About", link: "/about" },
            { text: "Careers", link: "/careers" },
            { text: "Contact", link: "/contact" }
          ]
        },
        {
          title: "Resources",
          links: [
            { text: "Blog", link: "/blog" },
            { text: "Documentation", link: "/docs" },
            { text: "Support", link: "/support" }
          ]
        }
      ],
      social: [
        { platform: "twitter", link: "#" },
        { platform: "linkedin", link: "#" },
        { platform: "github", link: "#" }
      ]
    },
    settings: {
      backgroundColor: "#1a1a1a",
      textColor: "#ffffff",
      padding: "4rem"
    }
  },
  MainContent: {
    name: "Main Content Section",
    type: "MainContent" as BlockType,
    content: {
      title: "Main Content",
      body: "Add your main content here. This can include text, images, and other media.",
      layout: "standard",
      sidebar: {
        enabled: false,
        widgets: []
      }
    },
    settings: {
      backgroundColor: "#ffffff",
      textColor: "#000000",
      padding: "2rem",
      maxWidth: "1200px"
    }
  }
};
