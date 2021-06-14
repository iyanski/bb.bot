'use strict';
const cors = require('cors');
const axios = require('axios');
const Config = require('./config');
const CAMPAIGN = Config.campaign;
const VERIFY_TOKEN = Config.verify_token;
const ACCESS_TOKEN = Config.access_token;
// Imports dependencies and set up http server
const
  express = require('express'),
  bodyParser = require('body-parser'),
  app = express().use(bodyParser.json()); // creates express http server

// Sets server port and logs message on success
app.listen(process.env.PORT || 1337, () => console.log('webhook is listening'));
app.use(cors());
// Adds support for GET requests to our webhook
app.get('/webhook', (req, res) => {

  // Your verify token. Should be a random string.
    
  // Parse the query params
  let mode = req.query['hub.mode'];
  let token = req.query['hub.verify_token'];
  let challenge = req.query['hub.challenge'];
    
  // Checks if a token and mode is in the query string of the request
  if (mode && token) {
  
    // Checks the mode and token sent is correct
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      
      // Responds with the challenge token from the request
      console.log('WEBHOOK_VERIFIED');
      res.status(200).send(challenge);
    
    } else {
      // Responds with '403 Forbidden' if verify tokens do not match
      res.sendStatus(403);      
    }
  }
});

app.post('/webhook', (req, res) => {  
  let body = req.body;

  // Checks this is an event from a page subscription
  if (body.object === 'page') {

    // Iterates over each entry - there may be multiple if batched
    body.entry.forEach(async function(entry) {

      // Gets the message. entry.messaging is an array, but 
      // will only ever contain one message, so we get index 0
      let webhook_event = entry.messaging[0];
      const customer_id = webhook_event.sender.id;
      if(webhook_event.postback && webhook_event.postback.title === "Get Started"){
        await sendReply(getTemplatePayload('privacy', customer_id));
        await sendReply(getQuickReplyPayload('privacy', customer_id));
      }
      if(webhook_event.message && webhook_event.message.quick_reply){
        if (isJson(webhook_event.message.quick_reply.payload)) {
          const quick_message_reply = JSON.parse(webhook_event.message.quick_reply.payload)
          if (quick_message_reply.terms) {
            if (quick_message_reply.terms.agree) {
              await sendReply(getQuickReplyPayload('registered_to_campaign', customer_id));
            } else {
              await sendReply(getTemplatePayload('privacy_notice', customer_id));
              await sendReply(getQuickReplyPayload('privacy', customer_id));
            }
          } else if (quick_message_reply.registration) {
            if (quick_message_reply.registration.registered) {
              await sendReply(getQuickReplyPayload('get_mobile_number', customer_id));
            } else {
              await onRegistration(customer_id);
            }
          }
        }
      } else if (webhook_event.message && webhook_event.message.text){
        let message = webhook_event.message.text;
    
        // Check if mobile number is registered. If it's registered, interpret this as age
        if (isMobileTruthy(message)) {
          console.log("isMobileTruthy");
          if (isMobileFormatCorrect(message)) {
            registerMobileNumber(message, customer_id, async (isRegistered) => {
              if (isRegistered) await onOTPValidation(customer_id);
            });
          } else {
            await sendReply(getQuickReplyPayload('invalid_phone_format', customer_id));
          }
        } else if(isValidAge(message)) {
          console.log("isValidAge");
          if (parseInt(message) >= 18) 
            await sendReply(getQuickReplyPayload('registration_mobile_number', customer_id));
          else {
            await sendReply(getQuickReplyPayload('no_to_minors', customer_id));
          }
        } else if(isValidOTPFormat(message)) {
          console.log("isValidOTPFormat");
          otpValidation(message, customer_id, async(isVerified) => {
            if (isVerified) await sendReply(getQuickReplyPayload('get_name', customer_id));
          })
        } else if (isRegistrationComplete(customer_id)) {
          await sendReply(getQuickReplyPayload('registration_completion', customer_id));
        }
      }
      console.log(webhook_event);
    });

    // Returns a '200 OK' response to all requests
    res.status(200).send('EVENT_RECEIVED');
  } else {
    // Returns a '404 Not Found' if event is not from a page subscription
    res.sendStatus(404);
  }
});

const sendReply = async (params) => {
  const url = `https://graph.facebook.com/v6.0/me/messages?access_token=${ACCESS_TOKEN}`;
  const headers = {'Content-Type': 'application/json'};
  return await axios.post(url, params, { headers: headers })
  .then((response, error) => {
    if (error) console.log("error", error)
    if (response) console.log("response")
  })
  .catch((error) => {
    console.log(error.response.data);
    return;
  });
}


// Template Payloads

const getTemplatePayload = (template, customer_id) => {
  const payloads = {
    privacy: privacyPayload(customer_id),
    privacy_notice: privacyNoticePayload(customer_id),
  }
  return({
    "recipient":{
      "id": customer_id
    },
    "message":{
      "attachment":{
        "type":"template",
        "payload": payloads[template]
      }
    }
  })
};

const privacyPayload = () => {
  return({
    "template_type":"generic",
    "elements":[
       {
        "title":"Privacy",
        "subtitle":"Please agree our Privacy Notice to understand how we will collect and use your personal data. For any questions on the use of your personal data, please contact bearbrand@email.ph, 02-123-4455 or toll free at 1-800- 826654398. Visit www.facebook.com/BearBrandPH/ for more info.",
        "default_action": {
          "type": "web_url",
          "url": "https://www.facebook.com/BearBrandPH/",
          "messenger_extensions": false,
          "webview_height_ratio": "COMPACT"
        },
        "buttons":[{
          "type": "web_url",
          "url": "https://www.facebook.com/BearBrandPH/",
          "title": "Click Here",
        }]
      },
    ]
  })
}

const privacyNoticePayload = () => {
  return({
    "template_type":"generic",
    "elements":[
       {
        "title":"Privacy",
        "subtitle":"You need to agree to our Privacy Policy for you to proceed.",
        "default_action": {
          "type": "web_url",
          "url": "https://www.facebook.com/BearBrandPH/",
          "messenger_extensions": false,
          "webview_height_ratio": "COMPACT"
        },
        "buttons":[{
          "type": "web_url",
          "url": "https://www.facebook.com/BearBrandPH/",
          "title": "Click Here",
        }]
      },
    ]
  })
}

// Quick Reply Payloads
const getQuickReplyPayload = (template, customer_id) => {
  const payloads = {
    privacy: agreeToPrivacyPayload(),
    registered_to_campaign: registeredToCampaignPayload(),
    get_mobile_number: mobileNumberPayload("Please enter your registered mobile number."),
    invalid_phone_format: invalidMobilePhoneFormatPayload(),
    retry_mobile_number: retryMobileNumberPayload(),
    numerous_invalid_registration_attempts: numerousInvalidRegistrationAttemptsPayload(),
    get_age: getAgePayload(),
    registration_mobile_number: mobileNumberPayload("Enter your mobile number."),
    no_to_minors: noToMinorsPayload(),
    otp_validation_notification: otpNotificationPayload(),
    get_otp_code: getOTPPayload(),
    retry_otp_code: retryOTPCodePayload(),
    numerous_invalid_otp_request: numerousInvalidOtpRrequestPayload(),
    get_name: getNamePayload(),
    registration_completion: congratulatationPayload(),
  }
  return({
    "recipient":{
      "id": customer_id
    },
    "messaging_type": "RESPONSE",
    "message": payloads[template]
  })
};

const agreeToPrivacyPayload = () => {
  return(
    {
      "text": "Do you Agree?",
      "quick_replies":[
        {
          "content_type":"text",
          "title":"YES I AGREE!",
          "payload": JSON.stringify({
            terms: {
              agree: true
            }
          }),
        },{
          "content_type":"text",
          "title":"NO I DISAGREE!",
          "payload": JSON.stringify({
            terms: {
              agree: false
            }
          }),
        }
      ]
    }
  )
};

const registeredToCampaignPayload = () => {
  return(
    {
      "text": "Are you already registered to Bear Brand PMD Digital Raffle Promo Campaign?",
      "quick_replies":[
        {
          "content_type":"text",
          "title":"Yes",
          "payload": JSON.stringify({
            registration: {
              registered: true
            }
          }),
        },{
          "content_type":"text",
          "title":"Not Yet",
          "payload": JSON.stringify({
            registration: {
              registered: false
            }
          }),
        }
      ]
    }
  )
}

const mobileNumberPayload = (message) => {
  return(
    {
      "text": message,
    }
  )
}

const numerousInvalidRegistrationAttemptsPayload = () => {
  return(
    {
      "text": "You’ve made numerous invalid registration attempts. Please agree again to our Privacy Policy for you to proceed.",
    }
  )
}

const retryMobileNumberPayload = () => {
  return(
    {
      "text": "Sorry the mobile number you've enter is invalid. Please try again.",
    }
  )
}

const noToMinorsPayload = () => {
  return(
    {
      "text": "Sorry this Bear Brand promo requires you to be 18 years old or older. Thank you.",
    }
  )
}

const otpNotificationPayload = () => {
  return(
    {
      "text": "You will receive an OTP code to authenticate your mobile number. Please check your mobile phone.",
    }
  )
}

const getOTPPayload = () => {
  return(
    {
      "text": "Please enter the OTP code sent to your mobile number.",
    }
  )
}

const retryOTPCodePayload = () => {
  return(
    {
      "text": "Sorry incorrect OTP, please try again.",
    }
  )
}

const numerousInvalidOtpRrequestPayload = () => {
  return(
    {
      "text": "You’ve made numerous invalid attempts. Please register again",
    }
  )
}

const getAgePayload = () => {
  return(
    {
      "text": "Please enter your age.",
    }
  )
}

const getNamePayload = () => {
  return(
    {
      "text": "Please enter your First Name and Last Name (Juan Dela Cruz).",
    }
  )
}

const congratulatationPayload = () => {
  const permit_no = "XXXXXX";
  const series_no = "SSSSSS";
  return(
    {
      "text": `Congratulations and thank you for buying BEAR BRAND POWDERED MILK DRINK! You may now start collecting your raffle entries. Per DOH-FDA-CFRR Permit No. ${permit_no} s. ${series_no}. Please choose one of the options below to start.`,
    }
  )
}

const invalidMobilePhoneFormatPayload = () => {
  return(
    {
      "text": "Sorry the format you entered is invalid. Please use the valid format and try again (09xxxxxxx).",
    }
  )
}

const registerMobileNumber = async (mobile, customer_id, cb=null) => {
  console.log("Mobile No.", mobile)
  // API: TODO Call Phone Number Verification API
  const isMobileNumberRegistered = isNumberRegistered();
  if (isMobileNumberRegistered) return cb(isMobileNumberRegistered);
  else {
    if (isMobileValidationAbused(mobile)) {
      await sendReply(getQuickReplyPayload('numerous_invalid_registration_attempts', customer_id));
      await sendReply(getTemplatePayload('privacy', customer_id));
      await sendReply(getQuickReplyPayload('privacy', customer_id));
      return;
    } else {
      return await sendReply(getQuickReplyPayload('retry_mobile_number', customer_id));
    }
  }
  return;
}

const otpValidation = async (otp, customer_id, cb=null) => {
  const isOTPCodeValid = isValidOTPCode(otp);
  if (isOTPCodeValid) return cb(isOTPCodeValid);
  else {
    if (isOTPRequestAbused(otp)) {
      await sendReply(getQuickReplyPayload('numerous_invalid_otp_request', customer_id));
      onRegistration(customer_id);
    } else await sendReply(getQuickReplyPayload('retry_otp_code', customer_id));
  }
}

const onRegistration = async (customer_id) => {
  console.log("onRegistration");
  await sendReply(getQuickReplyPayload('get_age', customer_id));
}

const onOTPValidation = async (customer_id) => {
  await sendReply(getQuickReplyPayload('otp_validation_notification', customer_id));
  await sendReply(getQuickReplyPayload('get_otp_code', customer_id));
}

// Utils

const isJson = (str) => {
  try {
    JSON.parse(str);
  } catch (e) {
    return false;
  }
  return true;
}

const isMobileTruthy = (mobile) => {
  return mobile.match(/(((\+|00[- \.\(\)]*)[0-9]{1,2}|0)([- \.\(\)]*[0-9]){9,11})/)
}

const isMobileFormatCorrect = (mobile) => {
  return mobile.match(/^((09)[0-9]{9})/gm)
}

const isValidAge = (age) => {
  return age.match(/^((100)|(0)|([1-9][0-9]?))$/gm)
}

const isValidOTPFormat = (otp) => {
  return otp.match(/^([0-9]{6})/gm)
}

const isValidOTPCode = (otp) => {
  return otp === "415122"
}

const isMobileValidationAbused = (mobile) => {
  return false;
}

const isOTPRequestAbused = (otp) => {
  return false;
}

const isNumberRegistered = (mobile) => {
  return true;
}

const isRegistrationComplete = (customer_id) => {
  console.log("isRegistrationComplete", customer_id);
  return true;
}