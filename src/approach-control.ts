import { SubmissionStream } from 'snoostorm'
import Snoowrap, { ReplyableContent, Submission, VoteableContent } from 'snoowrap'
import axios, { AxiosError, AxiosResponse } from 'axios'
import * as fs from 'fs'
import * as path from 'path'

const TITLE_SLUG_REGEX  = /^(\b[A-Z0-9]{3,4}\b)+(?:[,\s-])+(?:RWY|Runway|\s)*(\d{1,2}[RLC]{0,1})*/
const ICAO_REGEX        = /(?!\bRWY\b)(\b[A-Z0-9]{3,4}\b)+/
const RWY_REGEX         = /(?:(?:RWY|Rwy|rwy|Runway|runway)+(?:\s)*([0-9]{1,2}(?:[RLC]{1})*))/

const pkg = path.join(__dirname, '..', 'package.json')
const version = JSON.parse(fs.readFileSync(pkg).toString()).version

process
    .on('unhandledRejection', (reason, p) => {
      console.error(reason, 'Unhandled Rejection at Promise', p);
    })
    .on('uncaughtException', err => {
      console.error(`Uncaught Exception thrown. ${err.stack}`);
      process.exit(1);
    })

const USER_AGENT = `ApproachControl/${version}`
const CLIENT_ID = process.env['CLIENT_ID']
const CLIENT_SECRET = process.env['CLIENT_SECRET']
const REDDIT_USERNAME = process.env['REDDIT_USERNAME'] ?? 'appraoch_control'
const REDDIT_PASSWORD = process.env['REDDIT_PASSWORD']

function main() {
    console.log('Contacting clearance delivery...')

    const client = getClient()

    const submissions = new SubmissionStream(client, {
        subreddit: 'shortfinal',
        limit: 10,
        pollTime: 2000
    })

    console.log('Cleared for takeoff.')
    submissions.on('item', processNewSubmission)    
    console.log('Contact departure, have a good flight.')
}

function getClient(): Snoowrap {
    const credsMissing = (CLIENT_ID === undefined 
            || CLIENT_SECRET === undefined 
            || REDDIT_USERNAME === undefined 
            || REDDIT_PASSWORD === undefined) 
        ? true
        : false
    
    if (credsMissing) {
        console.log('No flight plan on file. (check environment vars)')
        process.exit(1)
    }

    try {
        const client = new Snoowrap({
            userAgent: USER_AGENT,
            clientId: CLIENT_ID,
            clientSecret: CLIENT_SECRET,
            username: REDDIT_USERNAME,
            password: REDDIT_PASSWORD,
        })

        console.log('Readback correct.')

        return client
    } catch (err){
        console.log('Readback incorrect.  (login failed)')
        // console.log(`${(err as Error).message}`)
        process.exit(1)
    }
}

/**
 * Handler for new post submissions
 * Parse post title, extract airport and runway identifiers,
 * post sticky comment with discovered identifer and runway number
 * along with a link to to a web page with more information about
 * the airport in question.
 * 
 * @param item Snoowrap.Submission - the new post to /r/shortfinal
 */
async function processNewSubmission(item: Snoowrap.Submission) {
    console.log(`Cleared for the approach: ${item.title}`)
    // check if approach_control has already replied
    // if so, skip the submission
    const comments = await item.expandReplies({ limit: 20, depth: 1})
        .then(i => i.comments)

    for (const comment of comments) {
        if (comment.author.name === 'approach_control') {
            return
        }
    }

    const title_match = item.title.match(TITLE_SLUG_REGEX)
    const icao_match = item.title.match(ICAO_REGEX)
    const rwy_match = item.title.match(RWY_REGEX)

    // attempt to get the icao from the title match regex
    let icao = title_match?.[1]
        ? title_match[1]
        : undefined

    // if not found, try the ICAO specific match
    icao = icao
        ? icao
        : icao_match?.[1]

    // attempt to get the runway identifier from the title match regex
    let rwy = title_match?.[2]
        ? title_match[2]
        : undefined

    // if not found, try the runway specific match
    rwy = rwy
        ? rwy
        : rwy_match?.[1]

    const { recognized, url } = await getAirportUrl(icao ?? item.title)

    recognized
        ? undefined
        : console.log(`Negative ATIS: ${item.title}`)

    const body = getCommentBody(icao, rwy, url, recognized)

    const reply = item.reply(body) as VoteableContent<Submission>

    reply.distinguish({ sticky: true })
}

/**
 * Create the body for the sticky comment
 */
function getCommentBody(icao: string | undefined, rwy: string | undefined, url: URL, recognized: boolean ): string {
    
    const airport = icao
        ? `* Airport:  [${icao}](${url.toString()})`
        : `* Airport:  [unknown](${url.toString()})`

    const runway = rwy 
        ? `\n* Runway:  ${rwy}`
        : `\n* Runway:  unknown`

    const notRecognized = recognized
        ? undefined
        : `\n\nUnable to locate airport details. [Search for ${icao}](${url.toString()})`

    const notFound = icao
        ? undefined
        :   '\n\nAirport identifier unrecognized or missing from post title.'
          + '\n\nHere are some sample titles that the [appproach_control bot](https://www.reddit.com/r/shortfinal/comments/4rr0fo/approach_control_the_rshortfinal_bot/) can recognize:'
          + '\n\n* KBFI - 13R  Boeing Field, Seattle, WA  <= preferred'
          + '\n\n* KDFW RWY 17C Dallas-Fort Worth International Airport - Landin\' in the middle!'
          + '\n\n* U87, Smiley Creek, ID - Rwy 14'
          + '\n\n* KILG Wilmington, DE Runway 1'
          + '\n\n* Kelleys Island, Ohio (89D), RWY 27. Short final over Lake Erie.'
          + '\n\n'
          + '\n\n[Read more](https://www.reddit.com/r/shortfinal/comments/4rr0fo/approach_control_the_rshortfinal_bot/) about the appproach_control bot for more information how to get it to recognize your post.'

    const footer = notRecognized
        ? notFound ? notFound : notRecognized
        : ''

    return `${airport}`
         + `${runway}`
         + `${footer}`
}

/**
 * Attempt to find a URL for the SkyVector page for the specified airport.
 * If an exacct match for the airport identifier was found, recognized will be TRUE
 * @returns object { recognized: bool, url: URL }
 */
async function getAirportUrl(icao: string): Promise<{ url: URL, recognized: boolean }> {
    const baseUrl = new URL('https://skyvector.com/')
    const queryURL = `https://skyvector.com/api/airportSearch?query=${icao}`
    const defaultAirportURL = new URL('/airports', baseUrl)

    const response = await axios.get(queryURL, { maxRedirects: 0 })
        .then((response: AxiosResponse) => {
            console.log((`unexpected 200 response from: ${queryURL}`))
            return { recognized: false, url: new URL(queryURL) }
        })
        .catch(err => {
            if (err.response?.status !== 301 && err.response?.status != 302) {
                console.log(`axios request failed. url: ${queryURL}, err: ${err.message}`)
                return { recognized: false, url: defaultAirportURL }
            }

            const location = err.response?.headers['location'] as string ?? ''
            return { 
                recognized: location.includes('/airport'), 
                url: new URL(err.response?.headers['location'], baseUrl) 
            }
        })

    return response
}

main()