require "approach_control/version"
require "redd"

module ApproachControl
  TITLE_SLUG_REGEX  = /^([A-Z0-9]{3,4}|\([A-Z0-9]{3,4}\))+(?:[,\s-])+(?:RWY|Runway|\s)*(\d{1,2}[RLC]{0,1})*/
  ICAO_REGEX        = /\(([A-Z0-9]{3,4})\)+/
  RWY_REGEX         = /(?:(?:RWY|Rwy|rwy|Runway|runway)+(?:\s)*([0-9]{1,2}(?:[RLC]{1})*))/

  def self.auth!
    @reddit = Redd.it(
      :script,
      ENV['CLIENT_ID'],
      ENV['CLIENT_SECRET'],
      ENV['REDDIT_USER'],
      ENV['REDDIT_PASSWORD'],
      user_agent: "Approach Control Bot v0.0.1")

    @reddit.authorize!
  end

  def self.stream_all!
    @reddit.stream :get_new, 'shortfinal' do |item|
      @reddit.refresh_access! if @reddit.access.expired?

      puts item.title
      title_match = item.title.match(TITLE_SLUG_REGEX)
      icao_match  = item.title.match(ICAO_REGEX)
      rwy_match   = item.title.match(RWY_REGEX)

      icao =  title_match.nil? ? nil : title_match[1]
      rwy   = title_match.nil? ? nil : title_match[2]

      icao = icao || (icao_match.nil? ? nil : icao_match[1])
      rwy  = rwy  || (rwy_match.nil?  ? nil : rwy_match[1])

      puts "ICAO:  " + (icao || 'none')
      puts "RWY:   " + (rwy  || 'none')

      if icao
        commentators = item.comments.map do |comment|
           comment[:author]
        end

        unless commentators.include? 'approach_control'
          comment  = "* Airport:  [#{icao}](http://www.airportnavfinder.com/airport/#{icao})"
          comment += "\n* Runway:   #{rwy}" if rwy

          item.add_comment comment
        end
      end
    end
  end
end


begin
  ApproachControl.auth!
  ApproachControl.stream_all!
rescue Redd::Error::RateLimited => error
  sleep(error.time)
  retry
rescue Redd::Error::InvalidOAuth2Credentials
  puts "Expired OAuth Token.  Reauthorizing after a little nap..."
  sleep(60)
  ApproachControl.auth!
  retry
rescue Redd::Error => error
  puts error.message
  puts error.backtrace.join("\n")
  # 5-something errors are usually errors on reddit's end.
  raise error unless (500...600).include?(error.code)
  retry
rescue => e
  puts e.message
  puts e.backtrace.split("\n")
  sleep(60)
  ApproachControl.auth!
  retry
end

