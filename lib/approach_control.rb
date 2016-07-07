require "approach_control/version"
require "redd"

module ApproachControl
  TITLE_SLUG_REGEX = /^([A-Z0-9]{3,4}|\([A-Z0-9]{3,4}\))+(?:[,\s-])+(?:RWY|Runway|\s)*(\d{1,2}[RLC]{0,1})*/
  ICAO_REGEX        = /\(([A-Z0-9]{3,4})\)+/
  RWY_REGEX         = /(?:(?:RWY|Rwy|rwy|Runway|runway)+(?:\s)*([0-9]{1,2}(?:[RLC]{1})*))/

  def self.auth!
    r = Redd.it(
      :script,
      ENV['CLIENT_ID'],
      ENV['CLIENT_SECRET'],
      ENV['REDDIT_USER'],
      ENV['REDDIT_PASSWORD'],
      user_agent: "Approach Control Bot v0.0.1")

    r.authorize!
    r
  end

  def self.stream_all! reddit
    reddit.stream :get_new, 'shortfinal' do |item|
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
          comment  = "\nAirport:  [#{icao}](http://ourairports.com/airports/#{icao}/pilot-info.html#general)"
          comment += "\n&nbsp;"
          comment += "\n\nRunway:   #{rwy}" if rwy
          comment += "\n&nbsp;"
          comment += "\n\n_posted by approach_control bot_"
          comment += "\n&nbsp;"
          comment += "\n\n_if this data is incorrect please click 'report' to notifiy the moderators_"

          item.add_comment comment
        end
      end
    end
  end
end

reddit = ApproachControl.auth!

begin
  ApproachControl.stream_all! reddit
rescue Redd::Error::RateLimited => error
  sleep(error.time)
  retry
rescue Redd::Error => error
  # 5-something errors are usually errors on reddit's end.
  raise error unless (500...600).include?(error.code)
  retry
end

