import React from 'react';

interface DefaultEmailProps {
  subject?: string;
  title?: string;
  message?: string;
  data?: Record<string, any>;
}

export const DefaultEmail: React.FC<DefaultEmailProps> = ({
  subject = "Notification from Jaal Yantra Textiles",
  title = "Jaal Yantra Textiles",
  message = "Thank you for choosing Jaal Yantra Textiles.",
  data = {}
}) => {
  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{subject}</title>
      </head>
      <body style={{ 
        fontFamily: 'Arial, sans-serif', 
        margin: 0, 
        padding: 0, 
        backgroundColor: '#f4f4f4' 
      }}>
        <div style={{
          maxWidth: '600px',
          margin: '0 auto',
          padding: '20px',
          backgroundColor: '#ffffff',
          borderRadius: '8px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          marginTop: '20px',
          marginBottom: '20px'
        }}>
          {/* Header */}
          <div style={{
            textAlign: 'center',
            borderBottom: '2px solid #e0e0e0',
            paddingBottom: '20px',
            marginBottom: '30px'
          }}>
            <h1 style={{
              color: '#2c3e50',
              fontSize: '28px',
              margin: '0',
              fontWeight: 'bold'
            }}>
              {title}
            </h1>
            <p style={{
              color: '#7f8c8d',
              fontSize: '14px',
              margin: '5px 0 0 0',
              fontStyle: 'italic'
            }}>
              Premium Textiles & Fashion
            </p>
          </div>

          {/* Main Content */}
          <div style={{ marginBottom: '30px' }}>
            <p style={{
              color: '#34495e',
              fontSize: '16px',
              lineHeight: '1.6',
              margin: '0 0 20px 0'
            }}>
              {message}
            </p>

            {/* Dynamic Data Display */}
            {Object.keys(data).length > 0 && (
              <div style={{
                backgroundColor: '#f8f9fa',
                padding: '20px',
                borderRadius: '6px',
                border: '1px solid #e9ecef',
                marginTop: '20px'
              }}>
                <h3 style={{
                  color: '#495057',
                  fontSize: '16px',
                  margin: '0 0 15px 0',
                  fontWeight: '600'
                }}>
                  Details:
                </h3>
                {Object.entries(data).map(([key, value]) => (
                  <div key={key} style={{ marginBottom: '8px' }}>
                    <span style={{
                      color: '#6c757d',
                      fontSize: '14px',
                      fontWeight: '500',
                      textTransform: 'capitalize'
                    }}>
                      {key.replace(/_/g, ' ')}:
                    </span>
                    <span style={{
                      color: '#495057',
                      fontSize: '14px',
                      marginLeft: '8px'
                    }}>
                      {String(value)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div style={{
            borderTop: '1px solid #e0e0e0',
            paddingTop: '20px',
            textAlign: 'center'
          }}>
            <p style={{
              color: '#95a5a6',
              fontSize: '12px',
              margin: '0 0 10px 0'
            }}>
              This email was sent by Jaal Yantra Textiles
            </p>
            <p style={{
              color: '#95a5a6',
              fontSize: '12px',
              margin: '0'
            }}>
              © 2024 Jaal Yantra Textiles. All rights reserved.
            </p>
          </div>
        </div>
      </body>
    </html>
  );
};

export default DefaultEmail;
